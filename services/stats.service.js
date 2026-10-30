export function createStatsService({ users, galleries, shares }) {
  return {
    overview({ largest = 5 } = {}) {
      const userStats = users.stats();
      const totals = galleries.stats();
      return {
        users: userStats.total,
        admins: userStats.admins,
        galleries: totals.galleries,
        images: totals.images,
        avgImages: totals.avgImages,
        bytes: totals.bytes,
        liveShares: shares.countLive(),
        trashed: totals.trashed,
        largest: galleries.largest(largest),
      };
    },
  };
}
