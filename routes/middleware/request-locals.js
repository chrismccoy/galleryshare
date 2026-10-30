import { isNavActive, navFor } from '../../config/navigation.js';
import { isAdmin } from '../../domain/roles.js';

function lazy(target, name, compute) {
  let done = false;
  let value;
  Object.defineProperty(target, name, {
    enumerable: true,
    configurable: true,
    get() {
      if (!done) {
        value = compute();
        done = true;
      }
      return value;
    },
  });
}

export function avatarInitial(name) {
  const [first = ''] = String(name ?? '');
  return first.toUpperCase();
}

export function requestLocals({ galleriesService, sharesService, usersService, invitesService, activityService } = {}) {
  return (req, res, next) => {
    res.locals.user = req.user;
    lazy(res.locals, 'avatarInitial', () => avatarInitial(res.locals.user?.display_name));
    const currentPath = req.path;
    res.locals.currentPath = currentPath;
    lazy(res.locals, 'navCounts', () => {
      const admin = isAdmin(req.user);
      return {
        activity: activityService && req.user ? activityService.countForUser(req.user) : 0,
        galleries: galleriesService && req.user ? galleriesService.countLive(req.user.id) : 0,
        trash: galleriesService && req.user ? galleriesService.countTrashed(req.user.id) : 0,
        allActivity: activityService && admin ? activityService.countForAdmin() : 0,
        users: usersService && admin ? usersService.stats().total : 0,
        invites: invitesService && admin ? invitesService.countPending() : 0,
        allGalleries: galleriesService && admin ? galleriesService.countLive() : 0,
        shares: sharesService && admin ? sharesService.countLive() : 0,
      };
    });
    lazy(res.locals, 'nav', () =>
      navFor(req.user).map((group) => ({
        ...group,
        links: group.links.map((link) => ({
          ...link,
          on: isNavActive(link, currentPath),
          badge: link.badgeKey ?? null,
          count: link.badgeKey ? (res.locals.navCounts[link.badgeKey] ?? 0) : 0,
        })),
      })),
    );
    next();
  };
}
