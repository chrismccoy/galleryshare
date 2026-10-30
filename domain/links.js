import { ValidationError } from '../lib/errors.js';


export function linkStatus(row, atIso) {
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'used';
  if (row.expires_at < atIso) return 'expired';
  return 'pending';
}

const PROBLEM_TEXT = Object.freeze({
  invalid: 'is not valid.',
  revoked: 'has been revoked.',
  used: 'has already been used.',
  expired: 'has expired.',
});

export function linkProblem(kind, status) {
  return status === 'pending' ? null : `This ${kind} link ${PROBLEM_TEXT[status]}`;
}


export function createLinkLookup({ byToken, kind, nowIso, refuse = () => null }) {
  const statusOf = (row) => linkStatus(row, nowIso());

  const problemForRow = (row) =>
    row ? (refuse(row) ?? linkProblem(kind, statusOf(row))) : linkProblem(kind, 'invalid');

  function requireUsable(token) {
    const row = byToken(token);
    const reason = problemForRow(row);
    if (reason) throw new ValidationError(reason);
    return row;
  }

  const concurrentUseMessage = () => linkProblem(kind, 'used');

  function useOnce(token, use) {
    const result = use(requireUsable(token));
    if (result === false) throw new ValidationError(concurrentUseMessage());
    return result;
  }

  return {
    statusOf,
    problemForRow,
    problemForToken: (token) => problemForRow(byToken(token)),
    requireUsable,
    useOnce,
    concurrentUseMessage,
  };
}
