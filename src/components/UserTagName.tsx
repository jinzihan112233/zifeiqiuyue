import { userTagNames, type UserTag } from '../modules/user-tag-labels';
export function UserTagName({ nickname, tag = 'regular', showTag = true }: { nickname: string; tag?: UserTag; showTag?: boolean }) {
  const safeTag = Object.hasOwn(userTagNames, tag) ? tag : 'regular';
  return <span className={'user-tag-name user-tag--' + safeTag}><span>{nickname}</span>{showTag && <small className="user-tag-label"> · {userTagNames[safeTag]}</small>}</span>;
}
