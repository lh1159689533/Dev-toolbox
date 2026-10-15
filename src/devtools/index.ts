// 在 Chrome DevTools 工具栏新增「录制回放」面板
chrome.devtools.panels.create('录制回放', '', 'src/devtools/panel.html', () => {
  // 面板创建成功
});
