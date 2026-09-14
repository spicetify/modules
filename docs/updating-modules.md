# Update modules from Spotify

Use the **Module Store** to update installed modules and themes. Most updates
take effect immediately. A stdlib update needs a restart because other modules
share its running code.

## Apply updates

Open the Module Store from Spotify's navigation bar, then follow these steps:

1. Select **Update all** to download the available updates.
2. If the Store shows **Apply stdlib update**, select it, then select
   **Apply and restart**. Playback stops while Spicetify rebuilds the client.
   You can select **Cancel** before confirming; the confirmation does not expire.
3. After Spotify returns, open the Store again. Update any modules that were
   held back until the new stdlib could run.

The Store clears an old staged-version notice once the loader reports that
version or a newer one running. Merely sending an apply request does not count
as completion.

## Repair an unavailable service

The desktop client can open the installed Spicetify app even when the background
service is unavailable. This recovery path does not require a terminal.

1. Select **Repair Spicetify** in the Store.
2. Read the restart notice, then select **Open Spicetify and restart**.
3. If your system asks whether to open Spicetify, accept that prompt.
4. Wait for Spotify to restart, then return to the Store to check the result.

This action uses the app handler registered by a v3 apply on macOS, Windows, or
Linux. The Store does not offer it in web or mobile clients. Availability also
depends on the local installation and the operating system allowing Spotify to
open the handler; a platform check alone does not prove that it works.

If the handler is missing or nothing opens, the Store keeps a diagnostic visible
instead of reporting success. Repair the Spicetify installation using your
installation method. **Check connection** tests the service again without
restarting Spotify.

An apply error stays visible until you choose another action. The Store never
automatically resends an uncertain request through the app handler: the original
request may still be running. Wait for it to finish before deliberately retrying.
