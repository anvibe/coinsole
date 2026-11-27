// Draws the Coinsole app icon: the logo's pixel coin and play button on a black tile that fills the Mac icon shape.
import AppKit
let out = CommandLine.arguments[1]
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}
func gradient(_ colors: [CGColor], _ stops: [CGFloat]) -> CGGradient { CGGradient(colorsSpace: space, colors: colors as CFArray, locations: stops)! }
// the tile, on Apple's grid: 824 points of a 1024 canvas
let rect = CGRect(x: 100, y: 100, width: 824, height: 824)
let tile = CGPath(roundedRect: rect, cornerWidth: 186, cornerHeight: 186, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: rgb(0x000000, 0.3))
ctx.addPath(tile); ctx.setFillColor(rgb(0x0b0b0c)); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState(); ctx.addPath(tile); ctx.clip()
ctx.drawLinearGradient(gradient([rgb(0x26272a), rgb(0x0e0f10), rgb(0x000000)], [0, 0.5, 1]), start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
// a soft light from the top gives the black tile some volume
ctx.drawRadialGradient(gradient([rgb(0xffffff, 0.12), rgb(0xffffff, 0)], [0, 1]), startCenter: CGPoint(x: 512, y: 990), startRadius: 0, endCenter: CGPoint(x: 512, y: 990), endRadius: 620, options: [])
ctx.restoreGState()
// a thin lit edge
ctx.saveGState()
ctx.addPath(CGPath(roundedRect: rect.insetBy(dx: 4, dy: 4), cornerWidth: 182, cornerHeight: 182, transform: nil))
ctx.setLineWidth(8); ctx.replacePathWithStrokedPath(); ctx.clip()
ctx.drawLinearGradient(gradient([rgb(0xffffff, 0.32), rgb(0xffffff, 0.06), rgb(0xffffff, 0.12)], [0, 0.5, 1]), start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
ctx.restoreGState()
// the coin with its play button, drawn in the logo's pixels (a 16x16 grid centred on the tile)
let px: CGFloat = 44, ox: CGFloat = 512 - 8 * px, top: CGFloat = 512 + 8 * px
func cell(_ x: Int, _ y: Int) -> CGRect { CGRect(x: ox + CGFloat(x) * px, y: top - CGFloat(y + 1) * px, width: px, height: px) }
let rim = CGMutablePath(), face = CGMutablePath(), play = CGMutablePath()
for y in 0..<16 {
    for x in 0..<16 {
        let d = hypot(Double(x) + 0.5 - 8, Double(y) + 0.5 - 8)
        if d <= 6.6 { rim.addRect(cell(x, y)) }
        if d <= 5.55 { face.addRect(cell(x, y)) }
    }
}
for (j, w) in [1, 2, 3, 4, 4, 3, 2, 1].enumerated() { for i in 0..<w { play.addRect(cell(6 + i, 4 + j)) } }
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 46, color: rgb(0xffd21f, 0.28))      // a faint gold glow lifts the coin off the black
ctx.addPath(rim); ctx.setFillColor(rgb(0xc78f00)); ctx.fillPath()
ctx.restoreGState()
ctx.addPath(face); ctx.setFillColor(rgb(0xffd21f)); ctx.fillPath()
ctx.addPath(play); ctx.setFillColor(rgb(0x0b0b0c)); ctx.fillPath()
try! NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
