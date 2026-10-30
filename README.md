# GalleryShare

GalleryShare is a private web app for making photo galleries and sharing them with a short link. Invited people sign in, upload many JPEG, PNG or WebP images at once (loose, in ZIP files, or both), give the gallery and each image a title and caption, put them in order and share the gallery. Anyone with the link sees the gallery in one of several themes, opens each image in a lightbox, a new tab or a page of its own, can copy an image's `.webp` address to post it elsewhere, and can download the whole gallery as a ZIP when the owner allows it. It is meant for small invited groups run by an admin.

## Admin Tools

- An overview page shows how many users and admins there are, the number of galleries and images, the average images per gallery, storage used, live share links, galleries in Trash, and the largest galleries.
- Admins see a list of every user with their role, status and join date.
- Admins can disable or re-enable an account, change a user's role, or delete a user after a separate confirmation page; deleting a user also deletes their galleries and image files.
- Admins can create a password reset link for a user, which is shown once for the admin to pass on.
- Admins can create single-use invite links for a new user or a new admin, with an optional label, and revoke unused ones.
- A pending invite link can be copied again later only when the server has a storage key (`SETTINGS_ENC_KEY`) set.
- Admins can browse every user's galleries, narrow the list to one user, and move any gallery to its owner's Trash.
- Admins can open any gallery in the same edit view the owner has: fix titles and captions, reorder, remove a single image, add images, switch the ZIP download, share or revoke. Removing one image that breaks the rules does not mean trashing the whole gallery.
- A gallery changed by an admin carries an "Edited by an admin" label for its owner.
- Images an admin adds count against the owner's storage and the gallery's limits.
- A list of all live share links shows each owner, gallery, view count, last visit and whether the link is paused.
- Admins can open a share link's detail page to see its last 100 page views and ZIP downloads, and revoke it.
- Admins can turn public sharing off for everyone and back on again without losing any links.
- Admins can override each upload limit, the number of rows per list page, whether shared gallery grids show titles and captions, the share theme and the image view in Settings, with no restart; an "In effect now" panel shows every value and whether it comes from `.env` or Settings. A number with nothing saved shows its `.env` value in its field; saved unchanged with its switch off, it is not stored, so it keeps following `.env`. As on the gallery edit page, Save settings sits on a bar pinned to the bottom of the screen that appears once something changes, with the unsaved count, Discard and the "Leave without saving?" dialog.
- Admin → Activity lists what happened across the app, with the IP address and browser of each event (see [Activity](#activity)).
- The admin account set up on the server cannot be changed, disabled or deleted from the app.
- An admin cannot disable, demote or delete their own account, and at least one active admin always remains.

## Activity

- The app records what happens, by area: Accounts (sign-ins and sign-outs, password changes and resets, invites, disabling, re-enabling, role changes and deleting users), Galleries (created, details changed, images added, removed or reordered, moved to Trash, restored, deleted, Trash emptied), Sharing (link shared or revoked, gallery visited, ZIP downloaded, public sharing switched), Settings (a setting changed), Security (failed sign-ins, rate limits hit) and System (server started or stopped, Trash and temp-file cleanup, demo data written).
- Admins see everything on Admin → Activity, with the IP address and browser of each event.
- Each user sees My activity in the side menu: their own actions, and what happened to their galleries and account. Visitors show as "Visitor" and admins as "An admin". It shows no IP addresses and no Security or System events, and never another user's activity.
- Both pages can be filtered by area and by gallery; admins can also filter by person. The filters offer every person and gallery that appears in the kept activity, including deleted users and galleries (marked "(deleted)") and galleries in the Trash (marked "(in Trash)"). Long lists show an "Older activity" link to page back.
- The Area pill is coloured by what happened: green when something was created, added, shared or opened, amber when it was changed, red when it was removed, revoked, refused or failed, blue for a visit or ZIP download, grey otherwise.
- The dashboard shows your five latest My activity entries, and the admin Overview the five newest of all activity, each with a link to the full page.
- Events of a deleted gallery or user stay and keep their names.
- A burst of refused requests shows as one "Rate limit hit" entry per limit window, not one per request.
- Activity is kept for `ACTIVITY_RETENTION_DAYS` (90 by default) and then removed automatically. Nothing is recorded for actions from before this feature was added.
- The server also logs the events (with Winston): one readable line per event on the console, and JSON lines in one log file per day under `LOG_DIR`, kept for `LOG_RETENTION_DAYS` (30 by default). `LOG_LEVEL` sets how much the console shows. Passwords, tokens and share, invite and reset links are never logged (see Logs in [SETUP.md](SETUP.md)).

## Making Galleries

- The Add gallery page takes images and ZIP files in one upload, mixed as you like: several images, any number of ZIP files, or both, chosen at once or dropped anywhere on the page.
- Only JPEG, PNG and WebP images (and ZIP files of them) are accepted; any other file refuses the whole upload. Images are checked by their content, not their file name.
- A ZIP may hold images in any folder; folders, `__MACOSX/`, hidden files and other files are skipped. Each image in a ZIP is checked by its content when you upload, and a renamed non-image is listed as skipped. A ZIP without usable images is fine next to other images, but an upload with no usable images at all is refused and no gallery is made.
- Every limit is checked before anything is stored: an upload over a limit is refused as a whole, with a message naming the limit.
- The images are added in the background. A job page shows how many are done, refreshes itself every few seconds, and opens the gallery when they are ready; you can leave it meanwhile.
- Added images are saved at once, with nothing to press: the gallery opens with "Images added and saved." The save bar appears only once you change a title, caption or detail.
- A file that turns out not to be a readable image is listed by its name on the gallery page, once (an image from a ZIP as `<zip name>/<file name>`); the good images are kept.
- An image that is already in the gallery is skipped and listed as "Already in this gallery." It counts as the same picture when it is identical, resized, recompressed or saved in another format (for example PNG instead of JPEG), even within the same upload. Crops, flips and rotations count as different pictures. Other galleries are not checked.
- Images arrive sorted by file name (natural order, so `IMG_2` comes before `IMG_10`): the loose images first, then each ZIP in order of its file name, its images in order of their path inside the ZIP, so each folder stays together. Later uploads are added at the end.
- An upload interrupted by a server restart is marked as stopped, and the images already added are kept.

## Editing a Gallery

- Give the gallery a title and an optional description; the title is the heading of the shared page.
- Give each image a title and a caption, both optional. On the shared page an image without a title shows only its caption, and an empty caption shows as "Image #x", where x is the image's current position and follows any reorder; an empty gallery title shows as "Untitled gallery".
- Changes to the details and to image titles and captions are saved together with Save gallery, on a bar that appears at the bottom of the screen as soon as something changes. It shows how many changes are unsaved and has a Discard button. With unsaved changes, a link or another button that would leave the page opens a "Leave without saving?" dialog (Stay, or Leave without saving); reloading, closing the tab or going Back gets the browser's own question.
- Drag images by their handle to reorder them, or use the Up and Down buttons; the new order is saved at once.
- If the gallery changed in the meantime (for example an admin removed an image), a reorder is refused with "This gallery changed. Reload and try again." and nothing moves.
- Delete an image with its Delete button: the image fades, the save bar counts it, and Save gallery removes it for good (Undo or Discard brings it back). Add more images and ZIP files to an existing gallery at any time.
- The original file name of each image is shown to the owner on the edit view only and is never sent to visitors.
- An "Allow ZIP download" switch, off by default, lets people with the link download all images as one ZIP file.
- "Share theme" (Site default, None, Frame, Dark wall, App window, Polaroid, Glass or Paper stack) picks the look of the gallery's shared page; Site default follows the admin's theme.
- "Image view" (Site default, Lightbox, New tab or Image page) decides what a click on a thumbnail of the shared gallery does; Site default follows the admin's choice.
- "Titles and captions on the grid" (Site default, Show or Hide) decides whether the shared grid shows the text under each thumbnail; Site default follows the admin's setting, and the lightbox always shows the text.
- When an admin lowers a limit below what a gallery already uses, the gallery stays viewable and editable; only new uploads are refused.

## Sharing Galleries

- Share a gallery to get a 7-character public link (`/s/<token>`) that someone without an account can open.
- Copy the link with one button; it keeps working until you revoke it, and revoking stops it at once.
- Each gallery has at most one live link, and sharing it again gives the same link.
- A gallery with two or more images shows as a grid of square thumbnails with hover zoom, with each image's title and caption underneath unless the gallery or the admin hides them; a click opens a lightbox with previous and next, arrow keys, Esc, a thumbnail strip, a counter, the caption and Save.
- Image addresses end in `.webp` (`/s/<token>/i/<public_name>.webp`, and `<public_name>-thumb.webp` for the thumbnail), so forums and other sites take them as images; older addresses (`…/<public_name>/web.webp`, `…/web`, and the same for `thumb`) still work. "Copy image link" in the lightbox, and under the image of a single-image gallery, copies the full address of the large image.
- A click on a thumbnail opens the lightbox, or, when the image view says so, the large image alone in a new tab, or the image's own page: `/s/<token>/i/<public_name>`, in the gallery's theme, with "Photo 3 of 24", Back to gallery, Previous and Next (disabled on the first and last image; the arrow keys work too), Save and Copy image link. Opening an image page is not counted as a visit. The view comes from `SHARE_IMAGE_VIEW`, its Settings override, or the gallery's own choice.
- Save downloads the large web copy of the image, named `<public_name>.webp`, where `public_name` is a random 10-character name given to each image at upload.
- A gallery with one image shows it embedded with its title and caption; a click opens it in a new tab. An empty gallery says it has no images yet.
- The shared page can wear one of six themes around its heading and grid, each showing the photo count: Frame (a white card), Dark wall (a navy panel), App window (a window with the title in its bar), Polaroid (tilted instant-photo frames on a board), Glass (a frosted panel on a dark, glowing page) and Paper stack (a card with sheets behind it). None keeps the plain page. The theme comes from `SHARE_THEME`, its Settings override, or the gallery's own choice.
- Download ZIP (when allowed) streams the originals, in gallery order, named `<public_name>-001.jpg`, `<public_name>-002.png` and so on.
- No original file name, owner name or email ever appears on a shared page, in a download name or inside the ZIP.
- A link pauses while its gallery is in the Trash, its owner's account is disabled, or public sharing is off, and works again once that changes.
- Every link that cannot be opened shows the same "This shared gallery isn't available." page without saying why.
- Chat apps that preview links see only a plain page with no images.
- Page views and ZIP downloads are logged for the admin, leaving out the owner, admins and link preview bots. The log keeps the time, the full IP address and the user-agent for 90 days. (The Activity pages are kept separately, for `ACTIVITY_RETENTION_DAYS`.)
- Shared pages are kept out of search engines and are never stored by the browser.

## Images and Privacy

- Each image is kept as three files under `MEDIA_DIR`: the original with its metadata removed, a web copy (WebP, at most 2000 px on the long edge) and a thumbnail (WebP, at most 600 px).
- The original's pixels are kept bit for bit: EXIF (camera, date, GPS), XMP, IPTC, comments and other metadata are removed without re-encoding, and only an orientation value is kept so it opens upright.
- The web copy and thumbnail are re-encoded, turned upright, and carry no metadata at all.
- Pixel-exact originals keep their ICC colour profile so colours stay exact. An ICC profile can contain text such as the camera or mobile device make and model (it does not hold a location or the time the picture was taken). If even the camera model must not leave the server, leave ZIP downloads off: the web copies and thumbnails carry no profile.
- Originals leave the server only inside the ZIP download; the grid and lightbox use the web copy and thumbnail.
- Image files are never placed in the public folder: every image request checks the owner's or an admin's session, or a live share link.
- Very large images (over 100 megapixels) and damaged files are refused.

## Accounts and Sign In

- Sign in with your email and password; email addresses are not case sensitive.
- New accounts are made only from an invite link from an admin, where you choose your name, email and password.
- A used, expired or revoked invite link explains that you need a new one.
- After signing in you return to the page you were trying to open.
- Change your password from your account page by entering your current one, which signs you out on your other devices.
- An admin can give you a one-time reset link, valid for 24 hours, to set a new password; asking for a new one cancels any earlier unused link.
- Passwords must be at least 10 characters long.
- Sign-ins last a set number of days (`SESSION_DAYS`) before you need to sign in again.
- Nothing is ever emailed, so invite and reset links are passed on by the admin.

## Dashboard, My Galleries and Trash

- The dashboard shows your galleries, images, storage used and live links, and your most recent galleries.
- My galleries lists every gallery with its cover, image count and size; shared ones carry a Shared label.
- Long lists show an "Older galleries" link to page back through earlier items.
- Deleting a gallery asks you to confirm and then moves it to the Trash instead of removing it; its link stops working meanwhile.
- The Trash shows when each gallery was deleted and the date it will be removed for good.
- Restore a gallery, delete one forever, or empty the whole Trash; deleting forever removes its image files too.
- Galleries left in the Trash are removed automatically after `TRASH_RETENTION_DAYS`.
- Badges in the menu show how many entries your My activity holds, how many galleries you have and how many are in your Trash; admins also see the number of Activity entries, users, pending invites, galleries and live share links. A badge is hidden at zero.

## Security

- Repeated sign-in, invite and reset attempts, failed share-link lookups and ZIP downloads are slowed down per IP address to stop guessing and heavy downloading. Opening or reloading a valid share link is never limited.
- Forms are protected against being submitted from other websites and expire if left open too long.
- A strict Content Security Policy allows only the app's own scripts and styles.
- Error messages never reveal which accounts exist or any internal details.
- A disabled or deleted user is signed out everywhere at once.

## Mobile and Accessibility

- On a mobile device the side menu becomes a scrolling strip at the top with a sign-out button.
- On a mobile device the edit view, the shared grid (one column), the lightbox, every share theme and the image pages fit the screen without sideways scrolling.
- Lists fold extra columns under each row on small screens.
- Images can be reordered with the keyboard using the Up and Down buttons.
- Messages are announced to screen readers, and confirm prompts move keyboard focus to the Yes button.
- On an image page, the left and right arrow keys go to the previous and next image.
- The lightbox keeps keyboard focus inside while it is open (Tab and Shift+Tab wrap around), and Esc closes it.
- Every card has a heading, so screen readers can jump between them.
- The "Leave without saving?" dialog opens with focus on Stay on this page; Esc or a click beside it also stays.
- Saved, error and skipped-file messages can be closed with their × button.

For setup instructions (limits, requirements, installation, configuration, production, demo data, tests and screenshots), see [SETUP.md](SETUP.md).
