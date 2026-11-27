// SPDX-License-Identifier: AGPL-3.0-only · Copyright © 2026 Fausto Melchiorre
// Coinsole: an arcade-cabinet launcher for your own games.
// The cabinet is a web page (ui/index.html) shown in a WKWebView; this file serves it,
// finds the games in the "Games" folder next to the app, and launches them.
//
// What counts as a game in Games/ (see docs/ADDING-GAMES.md):
//   - a Mac app (.app)                           → opens in its own window, on the cabinet's screen
//   - a folder that contains a .app              → same, using that app
//   - an .html file, or a folder with index.html → plays inside the cabinet's screen
//   - a folder with a start script (start.command, start.sh, run.sh, play.command) or a
//     program file at its top level              → runs that, from inside the folder
// Game info is optional: "<game name>.json" next to it, or "info.json" inside its folder, e.g.
//   {"publisher": "You", "year": "2026", "description": "…", "controls": "…", "aspect": "4:3"}
//   ("aspect" is the game's screen shape; the screens take it, default 16:9)
// A cover image is optional: "<game name>.png/.jpg" next to it in Games/, or "cover.png/.jpg" inside
// its folder. Without one, a .app shows its own icon.
import Cocoa
import CryptoKit
import GameController
import UniformTypeIdentifiers
import WebKit

let fm = FileManager.default
let appDir = Bundle.main.bundleURL.deletingLastPathComponent()
// Where games and the wallet live. A "Games" folder next to the app (what build.sh makes) keeps everything
// together in that folder. An installed app (from the .dmg, in Applications) has none, so it uses
// ~/Library/Application Support/Coinsole and puts the built-in games there.
let portable: Bool = {
    var isDir: ObjCBool = false
    let inApplications = appDir.lastPathComponent == "Applications"
    return !inApplications && fm.fileExists(atPath: appDir.appendingPathComponent("Games").path, isDirectory: &isDir) && isDir.boolValue
}()
let homeDir = portable ? appDir
    : fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Coinsole", isDirectory: true)
let gamesDir = homeDir.appendingPathComponent("Games", isDirectory: true)
let dataDir = homeDir.appendingPathComponent(".arcade", isDirectory: true)
let thumbsDir = dataDir.appendingPathComponent("thumbs", isDirectory: true)
let libraryFile = dataDir.appendingPathComponent("library.json")
let uiDir = Bundle.main.resourceURL!.appendingPathComponent("ui", isDirectory: true)
let imageExts = ["png", "jpg", "jpeg", "webp", "gif"]

/// A short diary of what happens to games (started, hidden, stopped, ended), in
/// ~/Library/Logs/Coinsole/Coinsole.log, so a game that closes unexpectedly can be explained.
func alog(_ text: String) {
    let dir = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Coinsole", isDirectory: true)
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent("Coinsole.log")
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
    let line = Data("\(f.string(from: Date())) \(text)\n".utf8)
    if let h = try? FileHandle(forWritingTo: file) { h.seekToEndOfFile(); h.write(line); try? h.close() }
    else { try? line.write(to: file) }
}

struct Game {
    let id: String        // the item's file name in Games/
    let name: String
    let kind: String      // "app", "web" or "exec"
    let target: URL       // the .app to open, or the html page to show
    let thumb: String?
}

// MARK: - library (favorites)

func loadLibrary() -> [String: Any] {
    guard let d = try? Data(contentsOf: libraryFile), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
    return j
}
func saveLibrary(_ lib: [String: Any]) {
    try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
    if let d = try? JSONSerialization.data(withJSONObject: lib, options: [.prettyPrinted]) { try? d.write(to: libraryFile) }
}

// MARK: - finding games

func firstApp(in dir: URL, depth: Int = 2) -> URL? {
    guard depth > 0, let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return nil }
    if let app = items.first(where: { $0.pathExtension == "app" }) { return app }
    for sub in items where (try? sub.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true && sub.pathExtension.isEmpty {
        if let app = firstApp(in: sub, depth: depth - 1) { return app }
    }
    return nil
}

/// A start script, or else a Mac program file, at the top level of a game folder.
func launcher(in dir: URL) -> URL? {
    for n in ["start.command", "start.sh", "run.sh", "play.command", "run.command"] {
        let u = dir.appendingPathComponent(n)
        if fm.fileExists(atPath: u.path) { return u }
    }
    guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else { return nil }
    return items.sorted { $0.lastPathComponent < $1.lastPathComponent }.first { u in
        guard (try? u.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true, fm.isExecutableFile(atPath: u.path),
              let h = try? FileHandle(forReadingFrom: u), let head = try? h.read(upToCount: 16), head.count == 16 else { return false }
        let magic = head.prefix(4).map { $0 }
        if magic == [0xca, 0xfe, 0xba, 0xbe] { return true }                       // universal program
        guard magic == [0xcf, 0xfa, 0xed, 0xfe] || magic == [0xce, 0xfa, 0xed, 0xfe] else { return false }
        return head[12] == 2                                                         // MH_EXECUTE, not a library
    }
}

/// Optional details shown on the Game info card.
func infoFor(id: String, name: String) -> [String: Any]? {
    let folder = gamesDir.appendingPathComponent(id)
    for u in [gamesDir.appendingPathComponent(name + ".json"), folder.appendingPathComponent("info.json"), folder.appendingPathComponent(name + ".json")] {
        if let d = try? Data(contentsOf: u), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { return j }
    }
    return nil
}

func urlPath(_ path: String) -> String { path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path }

/// The address of a picture in Games/ (covers and icons), for the cabinet's page.
func gameURL(_ file: URL) -> String {
    "arcade://app/games/" + urlPath(file.path.replacingOccurrences(of: gamesDir.path + "/", with: ""))
}

func iconThumb(for app: URL, id: String) -> String? {
    try? fm.createDirectory(at: thumbsDir, withIntermediateDirectories: true)
    let safe = id.replacingOccurrences(of: "/", with: "_") + ".png"
    let out = thumbsDir.appendingPathComponent(safe)
    if !fm.fileExists(atPath: out.path) {
        let icon = NSWorkspace.shared.icon(forFile: app.path)
        icon.size = NSSize(width: 512, height: 512)
        guard let tiff = icon.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { return nil }
        try? png.write(to: out)
    }
    return "arcade://app/thumbs/" + (safe.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? safe)
}

/// A square badge for the game, shown beside its title: "<game name>.icon.png" next to it in Games/, or
/// "icon.png" inside its folder. Without one the cover is shown there.
func badge(id: String, name: String) -> String? {
    for ext in imageExts {
        let folder = gamesDir.appendingPathComponent(id)
        for file in [gamesDir.appendingPathComponent(name + ".icon." + ext), folder.appendingPathComponent("icon." + ext), folder.appendingPathComponent(name + ".icon." + ext)]
        where fm.fileExists(atPath: file.path) { return gameURL(file) + "?v=\(modTime(file))" }
    }
    return nil
}

func cover(for item: URL, name: String) -> String? {
    for ext in imageExts {
        let side = gamesDir.appendingPathComponent(name + "." + ext)
        if fm.fileExists(atPath: side.path) { return gameURL(side) + "?v=\(modTime(side))" }
        for inside in [item.appendingPathComponent("cover." + ext), item.appendingPathComponent(name + "." + ext)]
        where fm.fileExists(atPath: inside.path) { return gameURL(inside) + "?v=\(modTime(inside))" }
    }
    return nil
}
/// The files that describe an app, kept next to it: "<name>.json", "<name>.png", "<name>.icon.png".
let sidecarSuffixes = ["json"] + imageExts + imageExts.map { "icon." + $0 }

/// A folder holding an app and its describing files is shown under the app's name, with its cover,
/// details and screen shape; any other folder keeps the folder's name.
func folderGameName(_ folder: URL, app: URL) -> String {
    let base = app.deletingPathExtension().lastPathComponent
    let describes = app.deletingLastPathComponent().standardizedFileURL.path == folder.standardizedFileURL.path
        && sidecarSuffixes.contains { fm.fileExists(atPath: folder.appendingPathComponent(base + "." + $0).path) }
    return describes && !fm.fileExists(atPath: folder.appendingPathComponent("info.json").path) ? base : folder.lastPathComponent
}

func modTime(_ u: URL) -> Int { Int((try? u.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? 0) }

/// An installed app copies its built-in games into the Games folder the first time, and refreshes them
/// after an update. A game you removed stays removed, and your own cover pictures are kept.
func installBuiltInGames() {
    guard !portable, let bundled = Bundle.main.resourceURL?.appendingPathComponent("games", isDirectory: true),
          let items = try? fm.contentsOfDirectory(at: bundled, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else { return }
    let defaults = UserDefaults.standard
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    let updated = defaults.string(forKey: "builtInVersion") != version
    var installed = Set(defaults.stringArray(forKey: "builtInGames") ?? [])
    for item in items where (try? item.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
        let name = item.lastPathComponent, dest = gamesDir.appendingPathComponent(name, isDirectory: true)
        if !fm.fileExists(atPath: dest.path) {
            if installed.contains(name) { continue }                       // removed by you
            guard (try? fm.copyItem(at: item, to: dest)) != nil else { continue }
        } else if updated, installed.contains(name) {
            for file in (try? fm.contentsOfDirectory(at: item, includingPropertiesForKeys: nil)) ?? [] where !file.lastPathComponent.hasPrefix("cover.") {
                let old = dest.appendingPathComponent(file.lastPathComponent)
                try? fm.removeItem(at: old)
                try? fm.copyItem(at: file, to: old)
            }
        }
        installed.insert(name)
    }
    defaults.set(Array(installed), forKey: "builtInGames")
    defaults.set(version, forKey: "builtInVersion")
}

func scanGames() -> [Game] {
    try? fm.createDirectory(at: gamesDir, withIntermediateDirectories: true)
    installBuiltInGames()
    guard let items = try? fm.contentsOfDirectory(at: gamesDir, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else { return [] }
    let names = Set(items.map { $0.deletingPathExtension().lastPathComponent })
    var games: [Game] = []
    for item in items {
        let ext = item.pathExtension.lowercased(), name = item.deletingPathExtension().lastPathComponent
        let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
        if ext == "app" {
            games.append(Game(id: item.lastPathComponent, name: name, kind: "app", target: item, thumb: cover(for: item, name: name) ?? iconThumb(for: item, id: item.lastPathComponent)))
        } else if ext == "html" || ext == "htm" {
            games.append(Game(id: item.lastPathComponent, name: name, kind: "web", target: item, thumb: cover(for: item, name: name)))
        } else if isDir {
            let index = item.appendingPathComponent("index.html")
            if fm.fileExists(atPath: index.path) {
                games.append(Game(id: item.lastPathComponent, name: name, kind: "web", target: index, thumb: cover(for: item, name: name)))
            } else if let app = firstApp(in: item) {
                let title = folderGameName(item, app: app)
                games.append(Game(id: item.lastPathComponent, name: title, kind: "app", target: app, thumb: cover(for: item, name: title) ?? iconThumb(for: app, id: item.lastPathComponent)))
            } else if let exe = launcher(in: item) {
                games.append(Game(id: item.lastPathComponent, name: name, kind: "exec", target: exe, thumb: cover(for: item, name: name)))
            }
        } else if imageExts.contains(ext), names.contains(name) {
            continue // a cover for a game with the same name
        }
    }
    return games.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
}

/// Brings an app's cover, details and icon along when it is added, so it keeps its name card and screen shape.
func copySidecars(of src: URL, to dest: URL) {
    let from = src.deletingPathExtension(), to = dest.deletingPathExtension()
    for suffix in sidecarSuffixes {
        let file = from.appendingPathExtension(suffix), copy = to.appendingPathExtension(suffix)
        if fm.fileExists(atPath: file.path), !fm.fileExists(atPath: copy.path) { try? fm.copyItem(at: file, to: copy) }
    }
}

// MARK: - serving the cabinet (arcade://app/...) and the web games (arcade://game-.../...)

/// Every web game is served from an address of its own: arcade://game-<from its file name>/<key>/<file>.
/// The host gives it a separate web origin, so it cannot reach the cabinet's page or another game's saved
/// data (and keeps its own between runs). The key, new each time Coinsole starts, stops a game from
/// working out the address of another game's files.
struct WebGame {
    let host: String
    let key = UUID().uuidString
    let root: URL        // the only folder it is served from
    let only: String?    // a single .html game: the only file in that folder it is served
    init(_ g: Game) {
        host = "game-" + SHA256.hash(data: Data(g.id.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
        let folder = gamesDir.appendingPathComponent(g.id, isDirectory: true)
        let isFolder = g.target.lastPathComponent != g.id
        root = isFolder ? folder : gamesDir
        only = isFolder ? nil : g.id
    }
}

final class FileServer: NSObject, WKURLSchemeHandler {
    private var webGames: [String: WebGame] = [:]   // by host

    /// The address to load a web game from; from then on its files can be served.
    func address(of g: Game) -> String {
        var game = WebGame(g)
        if let known = webGames[game.host], known.only == game.only { game = known }   // keep its key
        webGames[game.host] = game
        return "arcade://\(game.host)/\(game.key)/" + urlPath(g.target.lastPathComponent)
    }

    /// The file an address stands for, or nil if it may not be served.
    private func file(for url: URL) -> URL? {
        let parts = url.path.split(separator: "/", maxSplits: 1).map(String.init)
        guard parts.count == 2, let host = url.host else { return nil }
        let base: URL, path = parts[1]
        if host == "app" {
            // the cabinet's origin: its own page, and pictures. Nothing from a game may ever run here.
            guard let dir = ["ui": uiDir, "games": gamesDir, "thumbs": thumbsDir][parts[0]],
                  parts[0] != "games" || imageExts.contains((path as NSString).pathExtension.lowercased()) else { return nil }
            base = dir
        } else {
            guard let game = webGames[host], parts[0] == game.key else { return nil }
            if let only = game.only { return path == only ? game.root.appendingPathComponent(only) : nil }
            base = game.root
        }
        let file = base.appendingPathComponent(path).standardizedFileURL
        // never serve anything outside the folder asked for, not even through a link inside it
        guard file.resolvingSymlinksInPath().path.hasPrefix(base.resolvingSymlinksInPath().path + "/") else { return nil }
        return file
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = file(for: url), let data = try? Data(contentsOf: file) else { return fail(task) }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Content-Length": "\(data.count)", "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    private func fail(_ task: WKURLSchemeTask) { task.didFailWithError(URLError(.fileDoesNotExist)) }
}

// MARK: - the window: accepts games dropped onto it

final class CabinetView: WKWebView {
    var onDrop: (([URL]) -> Void)?
    var onDragging: ((Bool) -> Void)?
    private func files(_ info: NSDraggingInfo) -> [URL] {
        (info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if files(sender).isEmpty { return super.draggingEntered(sender) }
        onDragging?(true); return .copy
    }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { files(sender).isEmpty ? super.draggingUpdated(sender) : .copy }
    override func draggingExited(_ sender: NSDraggingInfo?) { onDragging?(false); super.draggingExited(sender) }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = files(sender)
        onDragging?(false)
        if urls.isEmpty { return super.performDragOperation(sender) }
        onDrop?(urls); return true
    }
}

// MARK: - app

/// A borderless window that still takes the keyboard (used for the full-screen kiosk mode).
final class KioskWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    // A key the page or a game has no use for comes back to the window, where macOS would play its alert sound
    // at every press. Shortcuts such as Cmd-Q are handled before this.
    override func keyDown(with event: NSEvent) {}
}

// macOS draws a frame from another origin at half speed until it is clicked or typed in, which a game played
// with a controller never is. Each web game's frame reports in here, from a script world of its own that the
// game cannot see, and Coinsole answers with an empty script, which counts as that first touch.
let wakeWorld = WKContentWorld.world(name: "coinsole")
let wakeScript = "if (parent === top && parent !== window) webkit.messageHandlers.wake.postMessage(null)"

final class Arcade: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: CabinetView!
    let files = FileServer()
    var games: [Game] = []
    var running: (id: String, pid: pid_t)?
    var runningWatch: NSKeyValueObservation?
    var runningApp: NSRunningApplication? // kept alive while it is being watched
    var aliveTimer: Timer?                // backup check that the game is still open

    // MARK: credit wallet
    // Like tokens at an arcade: you buy credits at the token machine, pressing Play costs one, and a
    // coin inside a game (to continue) costs one more. Kept in .arcade/library.json.
    var credits: Int {
        get { (loadLibrary()["credits"] as? Int) ?? 10 } // 10 free credits the first time
        set { var lib = loadLibrary(); lib["credits"] = min(9999, max(0, newValue)); saveLibrary(lib); sendWallet() }
    }
    func sendWallet() { send(["type": "wallet", "credits": credits]) }
    /// Environment for a game started from the cabinet: it starts with the credit Play paid for, and
    /// knows whom to ask for more coins.
    func gameEnvironment(screen: String?) -> [String: String] {
        var env = ["ARCADE_PID": "\(getpid())", "ARCADE_CREDITS": "1", "ARCADE_KIOSK": kiosk ? "1" : "0"]
        if let screen { env["ARCADE_SCREEN"] = screen }
        return env
    }
    var coinSignal: DispatchSourceSignal?
    /// Games ask for a coin with SIGUSR1 (their coin button); the answer is the same signal back.
    func listenForCoins() {
        signal(SIGUSR1, SIG_IGN)
        let src = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        src.setEventHandler { [weak self] in self?.coinRequested() }
        src.resume()
        coinSignal = src
        // SIGUSR2: the Xbox button in a game, "take me back to Coinsole"
        signal(SIGUSR2, SIG_IGN)
        let home = DispatchSource.makeSignalSource(signal: SIGUSR2, queue: .main)
        home.setEventHandler { [weak self] in
            guard let self, let r = self.running else { return }
            alog("Xbox button in the game: back to the cabinet, game paused")
            self.setTheater(false)
            gameVisible(false)
            NSApp.activate(ignoringOtherApps: true)
            self.window.makeKeyAndOrderFront(nil)
            self.send(["type": "paused"])
        }
        home.resume()
        homeSignal = home
    }
    var homeSignal: DispatchSourceSignal?
    func coinRequested() {
        guard let r = running else { return }
        if credits > 0 {
            credits -= 1
            kill(r.pid, SIGUSR1)
            alog("coin: 1 credit paid for \(r.id), \(credits) left")
        } else {
            // out of credits: the cabinet comes forward on the token machine; the game waits, paused
            alog("coin: wallet empty, showing the token machine")
            setTheater(false)
            gameVisible(false)
            NSApp.activate(ignoringOtherApps: true)
            send(["type": "paused"])
            send(["type": "needCredits"])
        }
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        listenForCoins()
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(files, forURLScheme: "arcade")
        // A web game's frame has its own origin, and by default WebKit forgets what such a frame saves (high
        // scores) when the app quits. This setting keeps it; origins stay apart. It has no public API.
        if config.preferences.responds(to: NSSelectorFromString("_setStorageBlockingPolicy:")) {
            config.preferences.setValue(0, forKey: "storageBlockingPolicy")   // 0: block no storage
        } else { alog("this macOS cannot keep web games' saved data between runs") }
        config.userContentController.add(self, name: "arcade")
        config.userContentController.add(self, contentWorld: wakeWorld, name: "wake")
        config.userContentController.addUserScript(WKUserScript(source: wakeScript, injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: wakeWorld))
        config.mediaTypesRequiringUserActionForPlayback = []
        web = CabinetView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.onDrop = { [weak self] urls in self?.importGames(urls) }
        web.onDragging = { [weak self] on in self?.send(["type": "dragging", "on": on]) }
        web.registerForDraggedTypes([.fileURL])

        // a normal Mac window (title bar: drag, resize, minimise, close); the green button or
        // Ctrl-Cmd-F switches to the full-screen arcade mode
        window = KioskWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 810), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Coinsole"
        window.delegate = self
        // the green button zooms (our own full screen), not a macOS full-screen Space a game could not open over
        window.collectionBehavior = [.fullScreenNone]
        window.backgroundColor = NSColor(red: 0.04, green: 0.02, blue: 0.09, alpha: 1)
        window.minSize = NSSize(width: 900, height: 506)
        window.contentAspectRatio = NSSize(width: 1672, height: 940) // the cabinet's shape, so it fills the window
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("Coinsole window") // opens where you left it
        window.makeKeyAndOrderFront(nil)
        watchControllers()
        watchKeys()
        NSApp.activate(ignoringOtherApps: true)

        web.load(URLRequest(url: URL(string: "arcade://app/ui/index.html")!))

        // refresh the list whenever you come back (games may have been copied into the folder in Finder)
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.sendList()
            // you came back to the cabinet while a game is open: it waits behind, paused
            if self.running != nil { self.send(["type": "paused"]) }
        }
        // Switching to another app (Chrome, Finder…) while a game is open: hide the game together
        // with the cabinet, so its window never floats over other apps. It waits, paused.
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] n in
            guard let self, let r = self.running, let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            if app.processIdentifier == r.pid || app.processIdentifier == ProcessInfo.processInfo.processIdentifier { return }
            // only a real switch to another app (Chrome, Finder…) hides the game; system overlays such as the
            // screenshot tool, Spotlight or Control Centre come and go without taking the game away
            let overlays: Set<String> = ["com.apple.screencaptureui", "com.apple.screenshot.launcher", "com.apple.Spotlight", "com.apple.controlcenter", "com.apple.notificationcenterui", "com.apple.dock", "com.apple.systemuiserver", "com.apple.loginwindow", "com.apple.SecurityAgent"]
            if app.activationPolicy != .regular || overlays.contains(app.bundleIdentifier ?? "") { return }
            do { self.gameVisible(false); alog("hid the game: switched to \(app.localizedName ?? app.bundleIdentifier ?? "another app")") }
            self.send(["type": "paused"])
        }
        DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name("coinsole.bigscreen"), object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.setTheater(!self.theater)
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] n in
            guard let self, let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self.gameEnded(app.processIdentifier)
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
    // quitting the cabinet also quits a game that is still open
    func applicationWillTerminate(_ note: Notification) {
        alog("Coinsole quitting")
        if let r = running { NSRunningApplication(processIdentifier: r.pid)?.terminate() }
    }

    /// The standard macOS About window, with who made Coinsole and a link to the website.
    @objc func showAbout() {
        let text = NSMutableAttributedString(string: "Made by Fausto Melchiorre\nfaustomelchiorre.com\n\nFree and open source (AGPL-3.0 licence).",
                                             attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.labelColor])
        let link = (text.string as NSString).range(of: "faustomelchiorre.com")
        text.addAttribute(.link, value: URL(string: "https://faustomelchiorre.com/")!, range: link)
        let centred = NSMutableParagraphStyle(); centred.alignment = .center
        text.addAttribute(.paragraphStyle, value: centred, range: NSRange(location: 0, length: text.length))
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Coinsole", .applicationVersion: "1.0", .version: "", .credits: text])
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Coinsole", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Coinsole", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Coinsole", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let gameItem = NSMenuItem(); main.addItem(gameItem)
        let gameMenu = NSMenu(title: "Games")
        gameMenu.addItem(withTitle: "Add Games…", action: #selector(addGames), keyEquivalent: "o")
        gameMenu.addItem(withTitle: "Show Games Folder", action: #selector(revealGames), keyEquivalent: "g")
        gameMenu.addItem(withTitle: "Exit Game on Screen", action: #selector(exitGame), keyEquivalent: "e")
        gameItem.submenu = gameMenu
        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        let fs = viewMenu.addItem(withTitle: "Enter / Exit Full Screen", action: #selector(toggleKiosk), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu
        NSApp.mainMenu = main
    }

    // MARK: what the window may show
    /// The window itself only ever shows the cabinet's page, and no frame (where web games play) may load
    /// anything from the cabinet's origin.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        let cabinet = url?.scheme?.lowercased() == "arcade" && url?.host?.lowercased() == "app"
        guard let frame = action.targetFrame else { return decisionHandler(.cancel) }   // a new window
        if frame.isMainFrame { decisionHandler(cabinet && url?.path == "/ui/index.html" ? .allow : .cancel) }
        else { decisionHandler(cabinet ? .cancel : .allow) }
    }

    // MARK: messages from the cabinet
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "wake" { web.evaluateJavaScript("void 0", in: message.frameInfo, in: wakeWorld); return }
        // only the cabinet's own page gives orders: a web game's frame can reach this handler too
        let sender = message.frameInfo
        guard sender.isMainFrame, sender.securityOrigin.protocol == "arcade", sender.securityOrigin.host == "app" else {
            if !refusedLogged { refusedLogged = true; alog("ignored a command that did not come from the cabinet's page") }
            return
        }
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        let id = body["id"] as? String
        switch cmd {
        case "list": sendList(); sendPadStatus(); sendWallet()
        case "buy":
            let n = body["amount"] as? Int ?? 0
            if n > 0 { credits += n; alog("token machine: +\(n) credits, now \(credits)") }
        case "spend": // a web game playing on the cabinet's screen
            // the same game asked again within a second (a double press): charge only once
            if let id, lastSpend.id == id, Date().timeIntervalSince(lastSpend.at) < 1 { alog("spend ignored: double press for \(id)"); return }
            if credits > 0 { credits -= 1; lastSpend = (id ?? "", Date()); alog("spent 1 credit on \(id ?? "?"), \(credits) left"); send(["type": "spent", "id": id ?? ""]) } else { send(["type": "needCredits"]) }
        case "launch": if let id { launch(id, rect: body["rect"] as? [Double]) }
        case "resume":
            if let r = running {
                alog("resume requested")
                bringToFront(r.pid)
                // if macOS keeps the cabinet in front anyway, step the cabinet's window behind the game's
                for delay in [0.15, 0.5, 1.0] {
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                        guard self.running?.pid == r.pid, let gameWin = self.gameWindowBelowCabinet(r.pid) else { return }
                        self.window.order(.below, relativeTo: gameWin)
                        alog("resume: put the cabinet behind the game window")
                    }
                }
                send(["type": "running", "id": r.id])
            }
        case "stop": alog("stop requested from the cabinet (\(body["why"] as? String ?? "?"))"); stopGame()
        case "quit": NSApp.terminate(nil)
        case "website": NSWorkspace.shared.open(URL(string: "https://faustomelchiorre.com/")!)
        case "padStatus": sendPadStatus()
        case "add": addGames()
        case "reveal": revealGames()
        case "fullscreen": toggleKiosk()
        case "bigscreen": setTheater(body["on"] as? Bool ?? !theater, web: true) // a game playing in the page
        case "exitFullscreen": if kiosk { setKiosk(false) }
        case "favorite":
            guard let id else { return }
            var lib = loadLibrary(), favs = (lib["favorites"] as? [String]) ?? []
            favs.removeAll { $0 == id }
            if body["on"] as? Bool == true { favs.append(id) }
            lib["favorites"] = favs; saveLibrary(lib)
        case "cover": if let id { chooseCover(id) }
        case "remove": if let id { remove(id) }
        default: break
        }
    }

    var refusedLogged = false

    func send(_ msg: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: msg), let s = String(data: d, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.arcadeReceive && window.arcadeReceive(\(s))")
    }
    /// Reads the Games folder in the background: macOS may ask for permission to open a folder
    /// on the Desktop, and the cabinet (and ⌘Q) must keep working while that question is open.
    var scanning = false
    func sendList(select: String? = nil) {
        if scanning { return }
        scanning = true
        // still reading after a moment: macOS is waiting for you to allow access to the folder
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { if self.scanning { self.send(["type": "access", "waiting": true]) } }
        DispatchQueue.global(qos: .userInitiated).async {
            let found = scanGames()
            DispatchQueue.main.async {
                self.scanning = false
                self.games = found
                self.sendScanned(select: select)
            }
        }
    }
    func sendScanned(select: String?) {
        var msg: [String: Any] = [
            "type": "list",
            "games": games.map { g -> [String: Any] in
                var o: [String: Any] = ["id": g.id, "name": g.name, "kind": g.kind]
                if let t = g.thumb { o["thumb"] = t }
                if let i = badge(id: g.id, name: g.name) { o["icon"] = i }
                if g.kind == "web" { o["url"] = files.address(of: g) }
                if let info = infoFor(id: g.id, name: g.name) { o["info"] = info }
                return o
            },
            "favorites": (loadLibrary()["favorites"] as? [String]) ?? [],
        ]
        if let select { msg["select"] = select }
        send(msg)
        if let r = running { send(["type": "running", "id": r.id]) }
    }

    // MARK: keyboard, to light the keys of the on-screen keyboard
    /// Coinsole's own window only (not other apps, and no permission needed): the page hears which of these
    /// keys goes down or up, even while a game playing inside it has the keyboard.
    func watchKeys() {
        let names: [UInt16: String] = [
            53: "Escape", 18: "Digit1", 19: "Digit2", 20: "Digit3", 21: "Digit4", 23: "Digit5", 22: "Digit6", 26: "Digit7", 28: "Digit8", 25: "Digit9", 29: "Digit0", 51: "Backspace",
            48: "Tab", 12: "KeyQ", 13: "KeyW", 14: "KeyE", 15: "KeyR", 17: "KeyT", 16: "KeyY", 32: "KeyU", 34: "KeyI", 31: "KeyO", 35: "KeyP", 33: "BracketLeft", 30: "BracketRight",
            57: "CapsLock", 0: "KeyA", 1: "KeyS", 2: "KeyD", 3: "KeyF", 5: "KeyG", 4: "KeyH", 38: "KeyJ", 40: "KeyK", 37: "KeyL", 36: "Enter",
            56: "ShiftLeft", 6: "KeyZ", 7: "KeyX", 8: "KeyC", 9: "KeyV", 11: "KeyB", 45: "KeyN", 46: "KeyM", 43: "Comma", 47: "Period", 60: "ShiftRight",
            59: "ControlLeft", 58: "AltLeft", 55: "MetaLeft", 49: "Space", 54: "MetaRight", 123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp"]
        let modifiers: [UInt16: NSEvent.ModifierFlags] = [56: .shift, 60: .shift, 59: .control, 58: .option, 55: .command, 54: .command, 57: .capsLock]
        NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.send(["type": "key", "code": "all", "down": false])   // releases made in another app are never heard
        }
        NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { [weak self] e in
            if let self, e.window === self.window, let code = names[e.keyCode] {
                if e.type == .flagsChanged { if let flag = modifiers[e.keyCode] { self.send(["type": "key", "code": code, "down": e.modifierFlags.contains(flag)]) } }
                else if e.type == .keyUp || !e.isARepeat { self.send(["type": "key", "code": code, "down": e.type == .keyDown]) }
            }
            return e
        }
    }

    // MARK: game controllers (Xbox, PlayStation, Switch Pro...), read through macOS
    var padSent = ""
    func watchControllers() {
        let nc = NotificationCenter.default
        nc.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] n in
            if let c = n.object as? GCController { self?.attach(c) }
            self?.sendPadStatus()
        }
        nc.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { [weak self] _ in self?.sendPadStatus() }
        GCController.controllers().forEach(attach)
        // also read the pad 60 times a second while the cabinet is in front, so the on-screen
        // controller follows every press and stick movement (change notices alone can be missed)
        let poll = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            guard NSApp.isActive, let gp = (GCController.current ?? GCController.controllers().first)?.extendedGamepad else { return }
            self?.sendPad(gp)
        }
        RunLoop.main.add(poll, forMode: .common)
    }
    func attach(_ c: GCController) {
        guard let g = c.extendedGamepad else { return }
        // Xbox and PlayStation pads (DualSense, DualShock 4) arrive the same way over Bluetooth, through
        // macOS's GameController framework. Keep the Xbox / PS button for the cabinet, not for macOS.
        if #available(macOS 11.3, *) { g.buttonHome?.preferredSystemGestureState = .disabled }
        if isPlayStation(c) {
            if #available(macOS 11.3, *) {
                (g as? GCDualSenseGamepad)?.touchpadButton.preferredSystemGestureState = .disabled
                (g as? GCDualShockGamepad)?.touchpadButton.preferredSystemGestureState = .disabled
            }
            c.light?.color = GCColor(red: 0.0, green: 0.44, blue: 0.82)   // light bar in Coinsole's PlayStation blue
        }
        alog("controller connected: \(c.vendorName ?? "?") [\(c.productCategory)]\(isPlayStation(c) ? " (PlayStation)" : "")")
        g.valueChangedHandler = { [weak self] gp, _ in self?.sendPad(gp) }
    }
    func isPlayStation(_ c: GCController) -> Bool {
        if c.extendedGamepad is GCDualSenseGamepad || c.extendedGamepad is GCDualShockGamepad { return true }
        let s = "\(c.productCategory) \(c.vendorName ?? "")".lowercased()
        return s.contains("dualsense") || s.contains("dualshock") || s.contains("playstation")
    }
    func sendPadStatus() {
        let c = GCController.controllers().first { $0.extendedGamepad != nil }
        var msg: [String: Any] = ["type": "padStatus", "connected": c != nil, "name": c?.vendorName ?? "Controller", "battery": -1,
                                  "kind": c.map { isPlayStation($0) ? "ps" : "\($0.productCategory) \($0.vendorName ?? "")".lowercased().contains("xbox") ? "xbox" : "other" } ?? ""]
        if let b = c?.battery, b.batteryState != .unknown { msg["battery"] = Int((b.batteryLevel * 100).rounded()) }
        send(msg)
    }
    /// Sends the pad in the standard layout: buttons A B X Y LB RB LT RT View Menu L3 R3 Up Down Left Right Home,
    /// axes left x/y and right x/y (down = positive), and the two trigger values.
    var openPanel: NSOpenPanel?   // the game picker, while it is open
    var padBWasDown = false
    func sendPad(_ g: GCExtendedGamepad) {
        // B on the controller closes the game picker (a macOS window the page cannot see)
        let bDown = g.buttonB.isPressed
        if bDown && !padBWasDown, let panel = openPanel { alog("game picker closed with B"); panel.cancel(nil) }
        padBWasDown = bDown
        let p = { (b: GCControllerButtonInput?) -> Int in (b?.isPressed ?? false) ? 1 : 0 }
        let b = [p(g.buttonA), p(g.buttonB), p(g.buttonX), p(g.buttonY), p(g.leftShoulder), p(g.rightShoulder), p(g.leftTrigger), p(g.rightTrigger),
                 p(g.buttonOptions), p(g.buttonMenu), p(g.leftThumbstickButton), p(g.rightThumbstickButton),
                 p(g.dpad.up), p(g.dpad.down), p(g.dpad.left), p(g.dpad.right), p(g.buttonHome)]
        let r = { (v: Float) -> Double in (Double(v) * 100).rounded() / 100 }
        let a = [r(g.leftThumbstick.xAxis.value), r(-g.leftThumbstick.yAxis.value), r(g.rightThumbstick.xAxis.value), r(-g.rightThumbstick.yAxis.value)]
        let t = [r(g.leftTrigger.value), r(g.rightTrigger.value)]
        let key = "\(b)\(a)\(t)"
        if key == padSent { return }
        padSent = key
        send(["type": "pad", "b": b, "a": a, "t": t])
    }

    var kiosk = false
    var windowedFrame: NSRect?
    /// Full-screen arcade mode: a borderless window over the whole display, with the Dock and
    /// menu bar hidden (a kiosk window, not a macOS full-screen Space, so a game can open on top).
    func setKiosk(_ on: Bool) {
        guard on != kiosk else { return }
        kiosk = on
        if on {
            windowedFrame = window.frame
            window.setFrameAutosaveName("") // remember the window's size, never the full-screen one
            let screen = window.screen ?? NSScreen.main!
            window.styleMask = [.borderless]
            window.setFrame(screen.frame, display: true)
            // like any full-screen Mac app: the menu bar (View › Exit Full Screen) slides down when the
            // pointer touches the top of the screen
            NSApp.presentationOptions = [.autoHideDock, .autoHideMenuBar]
        } else {
            NSApp.presentationOptions = []
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            window.title = "Coinsole"
            let area = (window.screen ?? NSScreen.main!).visibleFrame
            let back = windowedFrame ?? NSRect(x: area.midX - 720, y: area.midY - 405, width: 1440, height: 810)
            window.setFrame(back, display: true)
            // naming the window again restores its saved frame, which macOS may move to the display that
            // has the keyboard, so put the window back where it was
            window.setFrameAutosaveName("Coinsole window")
            window.setFrame(back, display: true)
        }
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web) // changing the window's style takes the keyboard away from the page
        DistributedNotificationCenter.default().postNotificationName(NSNotification.Name("coinsole.game.kiosk"), object: on ? "1" : "0", userInfo: nil, deliverImmediately: true)
        gameFollowWindow()
    }
    // MARK: big screen
    // The Xbox button (or F) in a game: Coinsole goes full screen and shows the game large,
    // inside an arcade cabinet (marquee, bezel, control deck), with the game's window on its screen.
    var theater = false
    var kioskBeforeTheater = false
    func setTheater(_ on: Bool, web: Bool = false) {
        // a game app needs to be open; a game playing in the page (web) asks for itself
        guard on != theater, web || !on || running != nil else { return }
        theater = on
        alog(on ? "big screen on" : "big screen off")
        if on { kioskBeforeTheater = kiosk; setKiosk(true) }
        send(["type": "theater", "on": on])
        if !on && !kioskBeforeTheater { setKiosk(false) }
        gameFollowWindow()
        // the cabinet's window was just re-laid out: keep the game's window on top of it (turning the big
        // screen on also brings back a game that was waiting, paused)
        if !web, let r = running, on || !gameHidden {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                guard self.running?.pid == r.pid else { return }
                if let w = self.gameWindowBelowCabinet(r.pid) { self.window.order(.below, relativeTo: w) }
                self.bringToFront(r.pid)
            }
        }
    }

    // green button: our full screen
    func windowShouldZoom(_ window: NSWindow, toFrame newFrame: NSRect) -> Bool { setKiosk(true); return false }
    // a game on the cabinet's screen follows the window when it moves or changes size
    func windowDidMove(_ notification: Notification) { gameFollowWindow() }
    func windowDidResize(_ notification: Notification) { gameFollowWindow() }
    func windowDidMiniaturize(_ notification: Notification) { if running != nil { gameVisible(false) } }
    var followWork: DispatchWorkItem?
    func gameFollowWindow() {
        guard running != nil else { return }
        followWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.running != nil else { return }
            // the page knows where its screen is (after its own re-layout)
            self.web.evaluateJavaScript("screenRect()") { result, _ in
                guard let a = (result as? [Any])?.compactMap({ ($0 as? NSNumber)?.doubleValue }), let rect = self.screenRect(a) else { return }
                DistributedNotificationCenter.default().postNotificationName(NSNotification.Name("coinsole.game.move"), object: rect, userInfo: nil, deliverImmediately: true)
                alog("game moved with the window: \(rect)")
            }
        }
        followWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
    }
    @objc func toggleKiosk() { setKiosk(!kiosk) }

    /// The cabinet screen's rectangle, given in page points, as "x,y,w,h" in screen points
    /// with the origin at the top left of the main display (what the game's window expects).
    func screenRect(_ a: [Double]?) -> String? {
        guard let a, a.count == 4 else { return nil }
        var r = NSRect(x: a[0], y: a[1], width: a[2], height: a[3])
        if !web.isFlipped { r.origin.y = web.bounds.height - r.maxY }
        let s = window.convertToScreen(web.convert(r, to: nil))
        let top = NSScreen.screens[0].frame.maxY
        return "\(Int(s.minX.rounded())),\(Int((top - s.maxY).rounded())),\(Int(s.width.rounded())),\(Int(s.height.rounded()))"
    }

    /// A game that has no window a few seconds after starting is usually waiting on a macOS
    /// question (a permission dialog): tell the cabinet, so it can say so.
    ///
    /// It also hands the screen over: macOS keeps a newly started app behind the one you are
    /// using, so for the first seconds the cabinet steps aside and brings the game's window
    /// to the front as soon as it exists.
    func checkWindow(pid: pid_t, id: String) {
        for delay in [0.3, 0.7, 1.2, 2.0, 3.0, 4.0, 5.0, 6.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                // a game you already left (switched app, Xbox button) stays hidden; no "waiting" message for it
                guard self.running?.pid == pid, !self.gameHidden else { return }
                if let gameWin = self.gameWindowBelowCabinet(pid) {
                    // the game's window is there but hidden under the cabinet: send the cabinet
                    // behind it and give the game the keyboard
                    self.window.order(.below, relativeTo: gameWin)
                    alog("launch: put the cabinet behind the game window (t=\(delay)s)")
                    self.bringToFront(pid)
                    self.send(["type": "running", "id": id])
                } else if self.hasWindow(pid) && NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
                    alog("launch: game window not found below the cabinet (t=\(delay)s), asking for focus")
                    self.bringToFront(pid)
                }
                if delay == 4.0 && !self.hasWindow(pid) { self.send(["type": "gameWaiting", "id": id]) }
            }
        }
    }
    /// The game's window number if it is on screen but stacked below the cabinet's window.
    func gameWindowBelowCabinet(_ pid: pid_t) -> Int? {
        let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? [] // front to back
        var cabinetSeen = false
        for w in list {
            let num = w[kCGWindowNumber as String] as? Int ?? -1
            if num == window.windowNumber { cabinetSeen = true; continue }
            let tall = (((w[kCGWindowBounds as String] as? [String: Any])?["Height"] as? Double) ?? 0) > 100
            if (w[kCGWindowOwnerPID as String] as? pid_t) == pid && tall { return cabinetSeen ? num : nil }
        }
        return nil
    }
    func hasWindow(_ pid: pid_t) -> Bool {
        let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
        return list.contains { w in
            (w[kCGWindowOwnerPID as String] as? pid_t) == pid && (((w[kCGWindowBounds as String] as? [String: Any])?["Height"] as? Double) ?? 0) > 100
        }
    }
    /// Hide or show the game's window. macOS cannot hide a helper app from outside, so the game
    /// does it itself when it receives this notice.
    var gameHidden = false
    func gameVisible(_ on: Bool) {
        gameHidden = !on
        // the cabinet's screen says what is really going on: playing, or waiting (paused) behind it
        if let r = running { send(["type": on ? "running" : "paused", "id": r.id]) }
        DistributedNotificationCenter.default().postNotificationName(NSNotification.Name("coinsole.game." + (on ? "show" : "hide")), object: nil, userInfo: nil, deliverImmediately: true)
    }
    func bringToFront(_ pid: pid_t) {
        guard let app = NSRunningApplication(processIdentifier: pid) else { return }
        gameVisible(true)
        var ok = false
        if #available(macOS 14.0, *) {
            NSApp.yieldActivation(to: app)
            ok = app.activate(from: NSRunningApplication.current, options: [.activateAllWindows])
        } else {
            ok = app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
        }
        NSLog("ArcadeHandover: activate=\(ok) appActive=\(NSApp.isActive) front=\(NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "-")")
        alog("handover to the game: activate=\(ok), front now \(NSWorkspace.shared.frontmostApplication?.localizedName ?? "-")")
    }
    func gameEnded(_ pid: pid_t) {
        guard let r = running, r.pid == pid else { return }
        alog("game ended: \(r.id) (pid \(pid))")
        if theater { DispatchQueue.main.async { self.setTheater(false) } }
        running = nil
        aliveTimer?.invalidate(); aliveTimer = nil
        runningWatch?.invalidate()
        runningWatch = nil
        runningApp = nil
        send(["type": "stopped", "id": r.id])
        NSApp.activate(ignoringOtherApps: true)
    }

    func stopGame() {
        guard let r = running else { return }
        // already gone (closed on its own): just put the cabinet back
        guard kill(r.pid, 0) == 0 else { return gameEnded(r.pid) }
        guard let app = NSRunningApplication(processIdentifier: r.pid) else {
            // a plain program (started from a script or a program file), which macOS does not list as an app
            kill(r.pid, SIGTERM)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { if self.running?.pid == r.pid { kill(r.pid, SIGKILL) } }
            return
        }
        guard !app.isTerminated else { return gameEnded(r.pid) }
        app.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { if !app.isTerminated { app.forceTerminate() } }
    }

    var launching = false
    var lastSpend: (id: String, at: Date) = ("", .distantPast)
    func launch(_ id: String, rect: [Double]? = nil) {
        guard let g = games.first(where: { $0.id == id }) else { return }
        // one game at a time: a second Play (double click, pad + click) while one is starting or open does nothing
        if running != nil || launching { alog("launch ignored: a game is already starting or open"); return }
        guard credits > 0 else { send(["type": "needCredits"]); send(["type": "stopped", "id": id]); return }
        let screen = screenRect(rect)
        if g.kind == "exec" { return runProgram(g, screen: screen) }
        guard g.kind == "app" else { return }
        let conf = NSWorkspace.OpenConfiguration()
        conf.activates = true
        // always start the copy in Games/, even if another copy of the same app is already open
        conf.createsNewApplicationInstance = true
        // let the game become the active app when it asks (macOS only allows that when the
        // app you are using hands over first)
        if #available(macOS 14.0, *), let bid = Bundle(url: g.target)?.bundleIdentifier {
            NSApp.yieldActivation(toApplicationWithBundleIdentifier: bid)
        }
        // games that understand ARCADE_SCREEN open borderless right on the cabinet's screen
        conf.environment = gameEnvironment(screen: screen)
        launching = true
        NSWorkspace.shared.openApplication(at: g.target, configuration: conf) { [weak self] app, err in
            DispatchQueue.main.async {
                guard let self else { return }
                self.launching = false
                if let app {
                    self.running = (id, app.processIdentifier)
                    self.gameHidden = false
                    // a helper app (no Dock icon) does not send the usual "quit" notice, so watch it directly
                    let pid = app.processIdentifier
                    self.runningWatch?.invalidate()
                    self.runningApp = app
                    self.runningWatch = app.observe(\.isTerminated, options: [.new]) { [weak self] a, _ in
                        if a.isTerminated { DispatchQueue.main.async { self?.gameEnded(pid) } }
                    }
                    self.credits -= 1 // Play costs one credit
                    alog("started \(id) (pid \(pid)), 1 credit, \(self.credits) left")
                    // macOS does not always report a helper app quitting, so also look every second
                    self.aliveTimer?.invalidate()
                    self.aliveTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                        if kill(pid, 0) != 0 && errno == ESRCH { self?.gameEnded(pid) }
                    }
                    self.send(["type": "running", "id": id])
                    self.checkWindow(pid: app.processIdentifier, id: id)
                } else {
                    self.send(["type": "toast", "text": "COULD NOT OPEN " + g.name.uppercased()])
                    self.send(["type": "stopped", "id": id])
                    NSLog("Coinsole: could not open \(g.target.path): \(err?.localizedDescription ?? "unknown")")
                }
            }
        }
    }

    /// Runs a game folder's start script or program, from inside that folder.
    func runProgram(_ g: Game, screen: String?) {
        let p = Process()
        let ext = g.target.pathExtension
        if ext == "sh" || ext == "command" { p.executableURL = URL(fileURLWithPath: "/bin/bash"); p.arguments = [g.target.path] }
        else { p.executableURL = g.target }
        p.currentDirectoryURL = g.target.deletingLastPathComponent()
        p.environment = ProcessInfo.processInfo.environment.merging(gameEnvironment(screen: screen)) { _, new in new }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self, self.running?.pid == proc.processIdentifier else { return }
                self.running = nil
                self.send(["type": "stopped", "id": g.id])
                NSApp.activate(ignoringOtherApps: true)
            }
        }
        do {
            try p.run()
            credits -= 1
            running = (g.id, p.processIdentifier)
            send(["type": "running", "id": g.id])
            checkWindow(pid: p.processIdentifier, id: g.id)
            // a program started this way does not come to the front by itself
            for delay in [0.6, 1.5] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    NSRunningApplication(processIdentifier: p.processIdentifier)?.activate(options: [.activateAllWindows])
                }
            }
        } catch {
            send(["type": "toast", "text": "COULD NOT START " + g.name.uppercased()])
            NSLog("Coinsole: could not run \(g.target.path): \(error.localizedDescription)")
        }
    }

    @objc func addGames() {
        let panel = NSOpenPanel()
        panel.title = "Add games to Coinsole"
        panel.message = "Choose a Mac game (.app), a game folder, or an HTML game"
        panel.prompt = "Add"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.treatsFilePackagesAsDirectories = false
        // its own window, not a sheet: a full-screen (borderless) window cannot show a sheet
        NSApp.activate(ignoringOtherApps: true)
        panel.level = .modalPanel
        openPanel = panel
        panel.begin { [weak self] r in
            self?.openPanel = nil
            if r == .OK { self?.importGames(panel.urls) }
        }
    }

    /// Copies each chosen item into Games/ (the original stays where it was).
    func importGames(_ urls: [URL]) {
        try? fm.createDirectory(at: gamesDir, withIntermediateDirectories: true)
        var added: [String] = []
        for src in urls {
            if src.standardizedFileURL.path.hasPrefix(gamesDir.standardizedFileURL.path + "/") { continue }
            var dest = gamesDir.appendingPathComponent(src.lastPathComponent)
            var n = 2
            while fm.fileExists(atPath: dest.path) {
                let base = src.deletingPathExtension().lastPathComponent, ext = src.pathExtension
                dest = gamesDir.appendingPathComponent("\(base) \(n)" + (ext.isEmpty ? "" : ".\(ext)")); n += 1
            }
            do {
                try fm.copyItem(at: src, to: dest); added.append(dest.lastPathComponent)
                if src.pathExtension.lowercased() == "app" { copySidecars(of: src, to: dest) }
            }
            catch { send(["type": "toast", "text": "COULD NOT COPY " + src.lastPathComponent.uppercased()]) }
        }
        let found = Set(scanGames().map(\.id))
        let games = added.filter { found.contains($0) }
        sendList(select: games.first)
        if !added.isEmpty {
            send(["type": "toast", "text": games.isEmpty ? "COPIED, BUT NO GAME FOUND IN IT" : "ADDED \(games.count) GAME\(games.count == 1 ? "" : "S")"])
        }
    }

    func chooseCover(_ id: String) {
        guard let g = games.first(where: { $0.id == id }) else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose a cover for \(g.name)"
        panel.allowedContentTypes = [.png, .jpeg, .webP, .gif]
        panel.beginSheetModal(for: window) { [weak self] r in
            guard r == .OK, let src = panel.url, let self else { return }
            for ext in imageExts { try? fm.removeItem(at: gamesDir.appendingPathComponent(g.name + "." + ext)) }
            try? fm.copyItem(at: src, to: gamesDir.appendingPathComponent(g.name + "." + src.pathExtension.lowercased()))
            self.sendList(select: id)
        }
    }

    /// Moves the game (and its cover) to the Trash, so it can be put back.
    func remove(_ id: String) {
        guard let g = games.first(where: { $0.id == id }) else { return }
        try? fm.trashItem(at: gamesDir.appendingPathComponent(id), resultingItemURL: nil)
        let own = (id as NSString).deletingPathExtension   // only the files kept next to this item, not a namesake's
        for suffix in sidecarSuffixes { try? fm.trashItem(at: gamesDir.appendingPathComponent(own + "." + suffix), resultingItemURL: nil) }
        try? fm.removeItem(at: thumbsDir.appendingPathComponent(id.replacingOccurrences(of: "/", with: "_") + ".png"))
        send(["type": "toast", "text": g.name.uppercased() + " MOVED TO TRASH"])
        sendList()
    }

    @objc func revealGames() {
        try? fm.createDirectory(at: gamesDir, withIntermediateDirectories: true)
        NSWorkspace.shared.open(gamesDir)
    }
    @objc func exitGame() { send(["type": "exitGame"]) }
}

let app = NSApplication.shared
let delegate = Arcade()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
