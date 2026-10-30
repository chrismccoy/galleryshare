import { SETTING_DEFS } from '../../config/index.js';
import { RESET_HOURS } from '../../domain/limits.js';
import { IMAGE_TYPES_TEXT } from '../../media/image-types.js';

export const SECTIONS = Object.freeze({
  public: {
    heading: 'Signing in and shared links',
    intro: 'What someone sees without a session: sign-in, invite and reset links, and shared galleries.',
  },
  user: {
    heading: 'Making galleries',
    intro: 'A regular user uploading images, editing a gallery, sharing it and keeping Trash tidy.',
  },
  admin: { heading: 'The admin', intro: 'Users, invites, every gallery, shared links, limits and settings.' },
});

export const CAPTIONS = Object.freeze({
  login: {
    section: 'public',
    title: 'Sign in',
    text: 'Email and password. There is no public sign-up: accounts come from invite links.',
  },
  'invite-register': {
    section: 'public',
    title: 'Invite link',
    text: 'A one-time invite opens this form: name, email and password, then the new user is signed in.',
  },
  'reset-password': {
    section: 'public',
    title: 'Reset link',
    text: 'An admin-issued one-time link that sets a new password and signs the user out everywhere.',
  },
  'share-multi': {
    section: 'public',
    title: 'Shared gallery',
    text: 'What anyone with the link sees: the title, description, a card grid with titles and captions, and Download ZIP when it is allowed. Nothing about the owner.',
  },
  'share-lightbox': {
    section: 'public',
    title: 'Lightbox',
    text: 'A click opens the image large, with previous and next, arrow keys, Esc, a thumbnail strip, Save and Copy image link.',
  },
  'share-theme-frame': {
    section: 'public',
    title: 'Theme: Frame',
    text: 'A white card with a soft shadow on a faint purple-grey page, and the photo count under the title.',
  },
  'share-theme-dark-wall': {
    section: 'public',
    title: 'Theme: Dark wall',
    text: 'A deep navy panel with a purple glow, a white title and thumbnails with a fine light edge.',
  },
  'share-theme-app-window': {
    section: 'public',
    title: 'Theme: App window',
    text: 'A window with the gallery title in its title bar; the description, photo count and ZIP button sit inside.',
  },
  'share-theme-polaroid': {
    section: 'public',
    title: 'Theme: Polaroid',
    text: 'A warm dotted board with every image in a white instant-photo frame, tilted a little left or right.',
  },
  'share-theme-glass': {
    section: 'public',
    title: 'Theme: Glass',
    text: 'A frosted-glass panel on a dark page with purple, cyan and pink glows.',
  },
  'share-theme-paper-stack': {
    section: 'public',
    title: 'Theme: Paper stack',
    text: 'A white card with two purple-tinted sheets stacked behind it and a dashed line under the title.',
  },
  'share-image-page': {
    section: 'public',
    title: 'Image page',
    text: 'With the Image page view each image has a page of its own in the gallery’s theme: Back to gallery, “Photo 2 of 24”, Previous and Next (disabled at the ends, arrow keys too), Save and Copy image link.',
  },
  'share-single': {
    section: 'public',
    title: 'Shared single image',
    text: 'A gallery with one image shows it embedded with its title, caption and Copy image link; a click opens it in a new tab.',
  },
  'share-unavailable': {
    section: 'public',
    title: 'Link not available',
    text: 'The same page for a revoked link, a gallery in Trash, a disabled owner, sharing turned off or a made-up address.',
  },

  'not-found': {
    section: 'user',
    title: 'Not found',
    text: 'Unknown pages, and admin pages for anyone who is not an admin.',
  },
  'new-gallery': {
    section: 'user',
    title: 'Add gallery',
    text: `Drop or choose ${IMAGE_TYPES_TEXT} images and ZIP files, mixed in one upload. The limits in effect are shown in the drop zone.`,
  },
  'new-gallery-chosen': {
    section: 'user',
    title: 'Files chosen',
    text: 'The list shows every chosen image and ZIP file, with a summary of the count and size, before the upload starts.',
  },
  'job-page': {
    section: 'user',
    title: 'Adding images',
    text: 'The upload is processed in the background. This page refreshes itself and opens the gallery when it is ready.',
  },
  'gallery-edit': {
    section: 'user',
    title: 'Edit a gallery',
    text: 'Title, description, the ZIP switch, grid text, share theme and image view; each image with its title and caption, drag to reorder or Up and Down, Delete; the share link with Copy and Revoke; add more images; Move to Trash.',
  },
  'gallery-edit-unsaved': {
    section: 'user',
    title: 'Unsaved changes',
    text: 'Changes wait for Save gallery: the bar at the bottom counts them, and an image marked with Delete fades with “Deleted when you save” until it is saved, undone or discarded.',
  },
  'gallery-leave-dialog': {
    section: 'user',
    title: 'Leave without saving?',
    text: 'With unsaved changes, a link or another button that would leave the page asks first: Stay on this page, or Leave without saving.',
  },
  'gallery-edit-skipped': {
    section: 'user',
    title: 'Files not added',
    text: `Files that are not ${IMAGE_TYPES_TEXT} images are listed once by name; the good images are kept.`,
  },
  dashboard: {
    section: 'user',
    title: 'Dashboard',
    text: 'Galleries, images, storage used and live share links, the most recent galleries and the latest activity.',
  },
  'my-activity': {
    section: 'user',
    title: 'My activity',
    text: 'Your own actions and what happened to your galleries and account: visits, ZIP downloads and an admin’s changes, coloured by what happened.',
  },
  'my-galleries': {
    section: 'user',
    title: 'My galleries',
    text: 'Every gallery of this user with its cover, image count and size; shared ones carry a pill.',
  },
  trash: {
    section: 'user',
    title: 'Trash',
    text: `Deleted galleries wait here for ${SETTING_DEFS.trashRetentionDays.defaultValue} days: restore one, delete it forever, or empty the whole Trash. Their links stop working meanwhile.`,
  },
  account: { section: 'user', title: 'Account', text: 'Change your own password.' },

  'admin-invite-created': {
    section: 'admin',
    title: 'Invite created',
    text: 'The one-time invite link, to copy and send by hand. With SETTINGS_ENC_KEY set it can be copied again later.',
  },
  'admin-reset-link-created': {
    section: 'admin',
    title: 'Reset link created',
    text: `A one-time password reset link for a user, valid for ${RESET_HOURS} hours.`,
  },
  'admin-overview': {
    section: 'admin',
    title: 'Overview',
    text: 'Users, galleries, images, storage on disk, live share links, the largest galleries and the newest activity.',
  },
  'admin-activity': {
    section: 'admin',
    title: 'Activity',
    text: 'Everything that happened across the app, newest first, with who, what, details and the IP address and browser; filter by person, area or gallery.',
  },
  'admin-users': {
    section: 'admin',
    title: 'Users',
    text: 'Everyone with an account, their role and status.',
  },
  'admin-user-detail': {
    section: 'admin',
    title: 'User detail',
    text: 'Issue a reset link, disable or enable the account, change the role, or delete the user.',
  },
  'admin-user-delete-confirm': {
    section: 'admin',
    title: 'Delete a user',
    text: 'Deleting asks for confirmation first and removes the user’s galleries and images.',
  },
  'admin-user-env-admin': {
    section: 'admin',
    title: 'The .env admin',
    text: 'The owner account is managed in .env, so it cannot be disabled, demoted or deleted here.',
  },
  'admin-invites': {
    section: 'admin',
    title: 'Invites',
    text: 'Create invites for users or admins; list them as pending, used, expired or revoked.',
  },
  'admin-galleries': {
    section: 'admin',
    title: 'Galleries',
    text: 'Every user’s galleries with owner, size and share state; Edit opens the same edit view the owner has.',
  },
  'admin-gallery-edit': {
    section: 'admin',
    title: 'Edited by an admin',
    text: 'An admin can remove a single image or fix a title; the owner then sees an “Edited by an admin” pill.',
  },
  'admin-shares': {
    section: 'admin',
    title: 'Shared links',
    text: 'Every live link with its owner, gallery, views, last opened and status, plus View, Details and Revoke.',
  },
  'admin-share-detail': {
    section: 'admin',
    title: 'Share link details',
    text: 'One link with its latest page views and ZIP downloads: time, IP address and a shortened user-agent.',
  },
  'admin-settings': {
    section: 'admin',
    title: 'Settings',
    text: 'Override switches for items per page, every upload limit, grid text, the share theme and the image view; the public sharing switch; and what is in effect now.',
  },
  'admin-account': {
    section: 'admin',
    title: 'Admin account',
    text: 'The .env admin’s password is managed in .env, so the form is replaced by a note.',
  },
});
