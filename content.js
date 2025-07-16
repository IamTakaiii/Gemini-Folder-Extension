(function() {
    'use strict';

    const CONSTANTS = {
        STORAGE_KEY: 'gemini_folders',
        FOLDER_UI_ID: 'gemini-folder-container',
        FOLDER_HEADER_ID: 'gemini-folder-header',
        DRAG_OVER_CLASS: 'drag-over'
    };

    const SELECTORS = {
        CHAT_HISTORY_CONTAINER: '.chat-history-list',
        CHAT_ITEM: 'div[data-test-id="conversation"]',
        FOLDER_ITEM: '.folder-item',
        SHOW_ALL_ITEM: '.show-all-item'
    };

    /** @type {Folders} */
    const state = {
        folders: {}
    };

 
    function init() {
        loadFolders();
        observeForChatList();
    }

    // --- Data Management ---
    async function loadFolders() {
        try {
            const result = await chrome.storage.sync.get([CONSTANTS.STORAGE_KEY]);
            state.folders = result[CONSTANTS.STORAGE_KEY] || {};
            console.log('Folders loaded:', state.folders);
        } catch (error) {
            console.error('Error loading folders:', error);
        }
    }

    function saveFolders() {
        chrome.storage.sync.set({ [CONSTANTS.STORAGE_KEY]: state.folders }, () => {
            if (chrome.runtime.lastError) {
                console.error('Error saving folders:', chrome.runtime.lastError);
            } else {
                console.log('Folders saved.');
            }
        });
    }

    // --- 3. Performance: Efficient DOM Observation ---

    /**
     * Observes the body for the main chat list to appear once.
     * More efficient than a persistent, broad observer.
     */
    function observeForChatList() {
        const observer = new MutationObserver((mutations, obs) => {
            const chatHistoryList = document.querySelector(SELECTORS.CHAT_HISTORY_CONTAINER);
            if (chatHistoryList) {
                console.log('Chat history list found. Initializing UI.');
                injectUI(chatHistoryList);
                document.querySelectorAll(SELECTORS.CHAT_ITEM).forEach(makeSingleChatDraggable);
                observeChatListForNewItems(chatHistoryList);
                obs.disconnect();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * Precisely observes the chat list for new children AND for attribute changes.
     * This solves the race condition where a new chat is added to the DOM before
     * its 'jslog' ID attribute is populated.
     * @param {HTMLElement} chatListElement The chat list container element.
     */
    function observeChatListForNewItems(chatListElement) {
        const chatObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches(SELECTORS.CHAT_ITEM)) {
                                makeSingleChatDraggable(node);
                            }
                            // Also check for chat items within the new node
                            node.querySelectorAll(SELECTORS.CHAT_ITEM).forEach(makeSingleChatDraggable);
                        }
                    }
                }
                else if (mutation.type === 'attributes' && mutation.attributeName === 'jslog') {
                    if (mutation.target.matches(SELECTORS.CHAT_ITEM)) {
                        makeSingleChatDraggable(mutation.target);
                    }
                }
            }
        });

        chatObserver.observe(chatListElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['jslog']
        });
    }


    // --- UI Injection and Rendering ---

    function injectUI(container) {
        if (document.getElementById(CONSTANTS.FOLDER_UI_ID)) return;

        const folderContainer = document.createElement('div');
        folderContainer.id = CONSTANTS.FOLDER_UI_ID;

        const header = document.createElement('div');
        header.id = CONSTANTS.FOLDER_HEADER_ID;

        const title = document.createElement('span');
        title.textContent = 'Folders';
        title.id = 'folder-title';

        const newFolderBtn = document.createElement('button');
        newFolderBtn.textContent = '+';
        newFolderBtn.title = 'Create New Folder';
        newFolderBtn.onclick = handleCreateNewFolder;

        header.append(title, newFolderBtn);
        folderContainer.appendChild(header);

        container.prepend(folderContainer);

        renderFolders();
    }

    function renderFolders() {
        const container = document.getElementById(CONSTANTS.FOLDER_UI_ID);
        if (!container) return;

        // More efficient to build a fragment and append once
        const fragment = document.createDocumentFragment();

        // Clear only folder-related items
        container.querySelectorAll(`${SELECTORS.FOLDER_ITEM}, ${SELECTORS.SHOW_ALL_ITEM}`).forEach(el => el.remove());

        // "All Chats" button
        const showAll = document.createElement('div');
        showAll.className = 'all-chats folder-item';
        showAll.textContent = 'All Chats';
        showAll.onclick = () => filterChats(null);

        showAll.ondragover = handleDragOver;
        showAll.ondragleave = handleDragLeave;
        showAll.ondrop = handleDrop;

        fragment.appendChild(showAll);

        // Render each folder
        for (const folderId in state.folders) {
            const folder = state.folders[folderId];
            const folderEl = document.createElement('div');
            folderEl.className = 'folder-item';
            folderEl.dataset.folderId = folderId;
            folderEl.onclick = () => filterChats(folderId);
            folderEl.ondragover = handleDragOver;
            folderEl.ondragleave = handleDragLeave;
            folderEl.ondrop = handleDrop;

            const folderNameSpan = document.createElement('span');
            folderNameSpan.textContent = `${folder.name} (${folder.chatIds.length})`;
            folderNameSpan.className = 'folder-name';

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '×';
            deleteBtn.title = 'Delete folder';
            deleteBtn.className = 'delete-folder-btn';
            deleteBtn.onclick = (event) => {
                event.stopPropagation();
                handleDeleteFolder(folderId);
            };

            folderEl.append(folderNameSpan, deleteBtn);
            fragment.appendChild(folderEl);
        }

        container.appendChild(fragment);
    }

    // --- Event Handlers & Logic ---

    function handleCreateNewFolder() {
        const folderName = prompt('Enter a name for the new folder:');
        if (folderName?.trim()) {
            const folderId = `folder_${Date.now()}`;
            state.folders[folderId] = {
                name: folderName.trim(),
                chatIds: []
            };
            saveFolders();
            renderFolders();
        }
    }

    function handleDeleteFolder(folderId) {
        const folderName = state.folders[folderId]?.name;
        if (!folderName) return;

        if (confirm(`Are you sure you want to delete "${folderName}"?\n\nChats inside will not be deleted.`)) {
            delete state.folders[folderId];
            saveFolders();
            filterChats(null);
            renderFolders();
            console.log(`Deleted folder ${folderId}`);
        }
    }

    /**
     * Makes a single chat element draggable.
     * @param {HTMLElement} chatItem - The chat element to process.
     */
    function makeSingleChatDraggable(chatItem) {
        if (chatItem.draggable) return; // Already processed

        const jslog = chatItem.getAttribute('jslog');
        if (!jslog) return;

        // Extracts the unique chat ID (e.g., "1a2b3c...") from the jslog attribute
        const match = jslog.match(/"c_([a-f0-9]+)"/);
        if (match && match[1]) {
            const fullChatId = `/app/${match[1]}`;
            chatItem.draggable = true;
            chatItem.dataset.chatId = fullChatId;

            chatItem.ondragstart = (event) => {
                event.dataTransfer.setData('text/plain', fullChatId);
                event.dataTransfer.effectAllowed = 'move';
                setTimeout(() => chatItem.style.opacity = '0.5', 0);
            };

            chatItem.ondragend = () => {
                chatItem.style.opacity = '1';
            };
        }
    }
    
    // --- Drag & Drop Handlers ---
    
    function handleDragOver(event) {
        event.preventDefault();
        event.currentTarget.classList.add(CONSTANTS.DRAG_OVER_CLASS);
    }
    
    function handleDragLeave(event) {
        event.currentTarget.classList.remove(CONSTANTS.DRAG_OVER_CLASS);
    }

    function handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove(CONSTANTS.DRAG_OVER_CLASS);

        const chatId = event.dataTransfer.getData('text/plain');
        const folderId = event.currentTarget.dataset.folderId;

        if (!chatId) return;

        let wasInFolder = false;
        for (const fId in state.folders) {
            const index = state.folders[fId].chatIds.indexOf(chatId);
            if (index > -1) {
                state.folders[fId].chatIds.splice(index, 1);
                wasInFolder = true;
                break;
            }
        }

        if (folderId && state.folders[folderId]) {
            if (!state.folders[folderId].chatIds.includes(chatId)) {
                state.folders[folderId].chatIds.push(chatId);
                console.log(`Moved chat ${chatId} to folder ${folderId}`);
            }
        } else if (wasInFolder) {
            console.log(`Removed chat ${chatId} from its folder.`);
        }

        saveFolders();
        renderFolders();
        filterChats(folderId || null);
    }

    /**
     * Shows or hides chats based on the selected folder.
     * @param {string|null} folderId - The ID of the folder to show, or null to show all.
     */
    function filterChats(folderId) {
        const chatsToShow = folderId ? state.folders[folderId]?.chatIds : null;
        const allChatElements = document.querySelectorAll(SELECTORS.CHAT_ITEM);
        
        document.querySelectorAll(SELECTORS.FOLDER_ITEM).forEach(el => {
            const elFolderId = el.dataset.folderId;
            el.classList.toggle('active', folderId === elFolderId);
        });

        allChatElements.forEach(chatEl => {
            const chatId = chatEl.dataset.chatId;
            const isVisible = !chatsToShow || (chatId && chatsToShow.includes(chatId));
            chatEl.style.display = isVisible ? '' : 'none';
        });
    }

    init();

})();