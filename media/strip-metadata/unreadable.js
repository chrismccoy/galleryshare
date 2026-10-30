import { UnreadableImageError } from '../../lib/errors.js';
import { UNREADABLE_IMAGE_MESSAGE } from '../image-types.js';

export function unreadableError() {
  return new UnreadableImageError(UNREADABLE_IMAGE_MESSAGE);
}
