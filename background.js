chrome.action.onClicked.addListener((tab) => {
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TABLE_FILTER_OVERLAY' });
});
