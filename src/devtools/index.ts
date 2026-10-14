// 在 Chrome DevTools 工具栏新增「操作录制」面板
chrome.devtools.panels.create('操作录制', '', 'src/devtools/panel.html', () => {
  // 面板创建成功
});
