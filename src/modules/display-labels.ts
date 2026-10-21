const labels: Record<string, string> = {
  article: '站方文章', post: '社区帖子', member: '成员', editor: '编辑', admin: '管理员',
  draft: '草稿', unpublished: '未公开', public: '已公开', hidden: '已下架', purged: '已清除',
  pending: '待审核', approved: '已通过', returned: '已退回', withdrawn: '已撤回',
  open: '开放', locked: '已锁定', visible: '可见', resolved: '已处理', dismissed: '已驳回',
  active: '正常', banned: '已封禁', done: '已完成',
  save: '保存工作稿', submitted: '提交审核', restored: '恢复公开',
  'discussion:hide': '隐藏评论', 'discussion:restore': '恢复评论显示',
  'discussion:lock': '锁定讨论', 'discussion:unlock': '解锁讨论',
  'discussion:hide-content': '下架内容', 'discussion:restore-content': '恢复内容公开',
  'discussion:ban': '封禁作者', 'discussion:dismiss': '驳回举报',
  category: '栏目', intro: '简介', afterword: '后记', demo: '演示内容', sourceUrl: '来源链接',
  originalVideoDate: '原视频日期', legacyDate: '历史记录日期',
  drafts: '工作稿', versions: '修订版本', submissions: '提交稿', snapshots: '发布快照',
  annotations: '文字批注', comments: '评论', reports: '举报', quotes: '金句',
  media: '图片', sharedReferences: '共享引用',
};

// Display only: API values, comparisons and saved identifiers stay unchanged.
export function displayLabel(value: string | null | undefined) {
  return value ? labels[value] || value : '—';
}
