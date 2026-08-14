# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Project and team

- Source repository: [teemoZipsa/PlainView](https://github.com/teemoZipsa/PlainView)
- License: MIT
- Committer and reviewer: [teemoZipsa](https://github.com/teemoZipsa)
- Release signing approver: [teemoZipsa](https://github.com/teemoZipsa)

PlainView is currently maintained by one person. Contributions from other people must be reviewed by the maintainer before they are merged. The maintainer is an authorized committer and may commit maintainer-authored changes directly. Every production signing request requires an explicit manual approval in SignPath.

## Build and signing process

Production Windows artifacts are built from this public repository by the manual-only `Sign Windows release` GitHub Actions workflow. The workflow:

1. Runs tests and builds on a standard GitHub-hosted Windows runner.
2. Uses committed npm and Cargo lock files.
3. Freezes Tauri's unused updater bundle marker and submits the application executable to SignPath before installer packaging.
4. Packages that signed executable into the NSIS and MSI installers.
5. Submits the final installer containers to SignPath and verifies all resulting Authenticode signatures.
6. Produces SHA-256 checksums alongside the signed release artifacts.

The release workflow can only be started manually and is restricted to the `master` branch. SignPath origin verification links each signed binary to the repository, branch, commit, and GitHub workflow run that produced it.

Only releases whose GitHub release notes explicitly say that they are signed by SignPath Foundation should be treated as signed releases. Earlier releases may be unsigned.

## Artifact identity

Signed PlainView executables must have `PlainView` as their product name. File and product versions must match the version committed in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

## Privacy

PlainView's runtime network and data-handling behavior is documented in the [Privacy Policy](PRIVACY.md).

## System changes and removal

The current-user installer installs PlainView for the current Windows user and registers supported image file associations. PlainView does not silently make itself the default image viewer; Windows requires the user to choose default-app associations. The installed version can be removed from Windows **Installed apps**. The portable executable does not install or register the application.
