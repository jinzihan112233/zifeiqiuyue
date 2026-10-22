import { APIError } from 'payload';
import { userTagNames, type UserTag } from './user-tag-labels';
export { userTagNames, tagOptions, type UserTag } from './user-tag-labels';
export function userTag(value: unknown): UserTag {
  if (typeof value !== 'string' || !Object.hasOwn(userTagNames, value)) throw new APIError('用户 Tag 无效。', 400);
  return value as UserTag;
}
export const canManageTags = (tag: UserTag) => tag === 'admin' || tag === 'owner';
export const tagRole = (tag: UserTag) => tag === 'admin' || tag === 'owner' ? 'admin' : 'member';
