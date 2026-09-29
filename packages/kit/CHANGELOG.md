# Changelog

## [0.4.2](https://github.com/spicetify/modules/compare/kit@0.4.1...kit@0.4.2) (2026-09-29)


### Bug Fixes

* **stdlib:** resolve icon names in Playbar.Button/Widget ([6098399](https://github.com/spicetify/modules/commit/6098399fb4dd62500da89cce527bcfe4b79e4376))

## [0.4.1](https://github.com/spicetify/modules/compare/kit@0.4.0...kit@0.4.1) (2026-09-29)


### Bug Fixes

* **kit:** record kind in vault add entries ([4246a82](https://github.com/spicetify/modules/commit/4246a82a5acb3b2385a27d1709cbdf2f5205e5f5))

## [0.4.0](https://github.com/spicetify/modules/compare/kit@0.3.1...kit@0.4.0) (2026-09-28)


### Features

* **kit:** add a remove script and clearer next steps to scaffolds ([3fee166](https://github.com/spicetify/modules/commit/3fee16642ee618fbe16c9f540466bc275d13b3ef))
* **kit:** launch Spotify from dev and remove the override on exit ([73a977e](https://github.com/spicetify/modules/commit/73a977ecfb0610a77b1cac0756a0d2570beb784e))
* **manager:** update managed Linux Spotify installations ([#19](https://github.com/spicetify/modules/issues/19)) ([469395a](https://github.com/spicetify/modules/commit/469395a7d2dfdec592e9b39395fe0c5647d133ab))
* strengthen module verification and runtime reliability ([#16](https://github.com/spicetify/modules/issues/16)) ([8790c4a](https://github.com/spicetify/modules/commit/8790c4a064b0298bf53430e14dfc75ae32d5f5e7))


### Bug Fixes

* **ci:** bump changed module releases ([97f97f9](https://github.com/spicetify/modules/commit/97f97f97b8ad135826474fa3ae97b7c224b2db0a))
* **kit:** fail a client evaluation when the socket closes early ([a4e3814](https://github.com/spicetify/modules/commit/a4e3814788085266bb3a9ad538890f5f300cde17))
* **kit:** finish dev shutdown cleanly after --once and watcher errors ([602ebf6](https://github.com/spicetify/modules/commit/602ebf654575c1bb38cdd2e32c221f68880adf05))
* **kit:** reject a flag given without its value ([7fe4c8e](https://github.com/spicetify/modules/commit/7fe4c8e5c51530968b9f6dd151bdd7d009ccab5b))
* **kit:** stop dev rebuilding on its own build output ([eb923c9](https://github.com/spicetify/modules/commit/eb923c99e4c3772634a4f0f9b2811217c34151b5))
* **kit:** stop hot-push leaving modules disabled ([3234ff1](https://github.com/spicetify/modules/commit/3234ff1cb1b5bd19fc8f8d9fc7a50e5d0bc06767))
* **stdlib:** pin profile settings below Spotify settings ([ab85f91](https://github.com/spicetify/modules/commit/ab85f9157c4aff9ce29e772b4445ad7534742a5a))
* **stdlib:** resolve the actual playlist menu component ([7e914ce](https://github.com/spicetify/modules/commit/7e914cee43a4323769a97f7e0c6d125732e4ba65))
* **themes:** style native Settings controls consistently ([098579d](https://github.com/spicetify/modules/commit/098579da23874e03137666e0664f6ac6d52313f9))

## [0.3.1](https://github.com/spicetify/modules/compare/kit@0.3.0...kit@0.3.1) (2026-09-05)


### Bug Fixes

* **kit:** track the stdlib native window controls capability release ([9a00bc4](https://github.com/spicetify/modules/commit/9a00bc4237d91df02825587eb8226f4f10ef7f24))
* **stdlib:** space navlinks with the anchor's own gap ([8ec5d71](https://github.com/spicetify/modules/commit/8ec5d713760b608170619483f04daa4dbf4e195f))

## [0.3.0](https://github.com/spicetify/modules/compare/kit@0.2.0...kit@0.3.0) (2026-08-19)


### Features

* **kit:** vendor the generated Platform typings ([133e95b](https://github.com/spicetify/modules/commit/133e95b28301b315e008443dc89c91c5dd3af752))


### Bug Fixes

* **kit:** track stdlib 1.10.1 ([06f5ca0](https://github.com/spicetify/modules/commit/06f5ca0eaf2dd4f7a6954f60cc4cc8c1018f3620))
* **scripts:** finish hardening the platform-types runner ([eccc4eb](https://github.com/spicetify/modules/commit/eccc4eba0a7bd323f64e2b525c0a31a192d456fd))

## [0.2.0](https://github.com/spicetify/modules/compare/kit@0.1.0...kit@0.2.0) (2026-08-18)

### Features

- **kit:** enforce the stdlib compatibility boundary ([ba4568d](https://github.com/spicetify/modules/commit/ba4568ddec77e7d8cfe1a16cd572b4a6ab5fa60d))
- **settings:** add standalone Spicetify settings page ([4c03efb](https://github.com/spicetify/modules/commit/4c03efbd877b69e75a715f8f377ca17312209f9f))
- **stdlib:** add owned panel API ([69436d3](https://github.com/spicetify/modules/commit/69436d3c4a78235a54416d05f0ae6f89bf012671))
- **stdlib:** own first-party modal surfaces ([9bbbedb](https://github.com/spicetify/modules/commit/9bbbedbca28bf3c5004de7c5304cb03f93746598))
- **stdlib:** own floating surfaces ([f0230ed](https://github.com/spicetify/modules/commit/f0230ed77b1c285ddc07640789a95edb42182b30))
- **stdlib:** publish stable module capability surface ([9e552ab](https://github.com/spicetify/modules/commit/9e552ab396bdea4f11c12c4f8e24fb892bd131bc))

### Bug Fixes

- **kit:** make package scripts portable on Windows ([e39d449](https://github.com/spicetify/modules/commit/e39d449d1c205eb80dd21bdd7055afcbe83a310c))
- **stdlib:** match native topbar button spacing ([34d98ba](https://github.com/spicetify/modules/commit/34d98ba39e0a4a175643c073b90cbc2a770e2d25))
- **stdlib:** theme current client fades ([b563a33](https://github.com/spicetify/modules/commit/b563a33e1eab2f671bae3e6aa4d09aa609cd55df))
