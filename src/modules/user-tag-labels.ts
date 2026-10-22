export const userTagNames = { regular: '普通', moon: '小秋月', admin: '管理员', owner: '站长' } as const;
export type UserTag = keyof typeof userTagNames;
export const tagOptions = Object.entries(userTagNames).map(([value, label]) => ({ value, label }));
