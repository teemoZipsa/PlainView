# PlainView Privacy Policy

Last updated: August 14, 2026

PlainView is a local image viewer. It does not include advertising, analytics, telemetry, user accounts, or cloud image storage. Images opened in PlainView are processed on the user's device and are not uploaded by PlainView.

## Network access

PlainView does not make an application-initiated network request during normal image viewing. It contacts the GitHub API only after the user selects **Check for updates** in Settings. The request retrieves the latest public release version for the PlainView repository. If the user then chooses to view the release, PlainView opens the public GitHub release page in the default browser.

GitHub handles these requests under the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Local data

PlainView stores viewing preferences and optional window-position settings in its local application data directory. It reads or modifies image files only in response to user actions such as open, copy, save, move, rename, or move to Recycle Bin.

PlainView does not transmit stored settings, file names, image contents, or image metadata to the project maintainer.

## Build-time services

Official signed releases may be built with GitHub Actions and signed by SignPath. These services process source code and release binaries during the release process; they are not contacted by the installed application during normal use.

## Contact

Questions and reports can be submitted through the [PlainView GitHub repository](https://github.com/teemoZipsa/PlainView/issues).
