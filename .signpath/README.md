# SignPath configuration

The XML files in `artifact-configurations` are the reviewed source copies of the artifact configurations that must be created in SignPath after the project's open-source application is approved.

The GitHub repository must define these Actions variables:

- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_APPLICATION_ARTIFACT_CONFIGURATION_SLUG`
- `SIGNPATH_RELEASE_ARTIFACT_CONFIGURATION_SLUG`

It must also define the `SIGNPATH_API_TOKEN` Actions secret. The token is entered only in GitHub's encrypted secret store and must never be committed.

The two signing stages are intentional. The application executable is signed before Tauri packages it so the executable installed by NSIS is trusted. The final request then signs the NSIS and MSI containers while verifying the previously signed portable and MSI-contained executables.

Tauri CLI versions that do not yet expose a `--no-binary-patching` option rewrite a reserved bundle-type marker before packaging and thereby invalidate an existing Authenticode signature. PlainView does not use Tauri's updater plugin, so `scripts/freeze-tauri-bundle-type.ps1` replaces that marker before the application signing request. Tauri then leaves the signed executable unchanged for both installers. The workflow compares SHA-256 hashes before and after bundling and fails if the executable changes.
