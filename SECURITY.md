# Security policy

## Supported versions

Only the [latest release](https://github.com/anvibe/coinsole/releases/latest) gets security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately: open the [Security tab](https://github.com/anvibe/coinsole/security) of this
repository and choose **Report a vulnerability**.

It helps to include:

- the Coinsole and macOS versions
- the steps that show the problem, and a sample file or game if one is needed
- what someone could do by exploiting it

Coinsole is a one-person project, so a reply may take a few days. Please allow time for a fix before
publishing details.

## What to know before adding games

Coinsole is a launcher: **only add games you trust.**

- Mac apps, start scripts and program files in the `Games` folder run with your account's permissions,
  exactly as if you opened them yourself.
- **In version 1.0, web games are not sandboxed:** they run inside Coinsole's own window, and a web game
  can reach the same functions as Coinsole's interface.
- **From version 1.1 on,** each web game plays in a sandboxed frame with a web
  origin of its own. It cannot send Coinsole's commands, reach its interface, or read another game's files
  or saved data, and talks to Coinsole only through [a few messages](docs/ADDING-GAMES.md#web-games). It is
  still a web page, so it can use the network.
- Coinsole does not check, scan or verify the games you add.

## Official downloads

Download Coinsole only from the
[Releases page](https://github.com/anvibe/coinsole/releases) of this repository. The released disk image
is signed with an Apple Developer ID and notarised by Apple. You can also build the app yourself from
this source with `build.sh`.
