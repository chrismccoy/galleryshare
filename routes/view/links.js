import { PATH_TO } from '../../config/urls.js';

export function baseUrl(publicUrl, req) {
  return publicUrl || `${req.protocol}://${req.get('host')}`;
}

export const shareUrl = (publicUrl, req, token) => `${baseUrl(publicUrl, req)}${PATH_TO.share(token)}`;

export const inviteUrl = (publicUrl, req, token) => `${baseUrl(publicUrl, req)}${PATH_TO.invite(token)}`;

export const resetUrl = (publicUrl, req, token) => `${baseUrl(publicUrl, req)}${PATH_TO.reset(token)}`;


export function createLinks(publicUrl) {
  return Object.freeze({
    share: (req, token) => shareUrl(publicUrl, req, token),
    invite: (req, token) => inviteUrl(publicUrl, req, token),
    reset: (req, token) => resetUrl(publicUrl, req, token),
  });
}
