
import { Html5Qrcode } from 'html5-qrcode';

// ==================== 网络状态监控器 ====================
class NetworkMonitor {
    constructor() {
        this.isOnline = navigator.onLine;
        this.listeners = [];
        this.statusEl = document.getElementById('networkStatus');
        this.statusDotEl = document.getElementById('networkStatusDot');
        this.statusTextEl = document.getElementById('networkStatusText');

        this.init();
    }

    init() {
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        this.updateUI();
    }

    onStatusChange(callback) {
        this.listeners.push(callback);
    }

    handleOnline() {
        this.isOnline = true;
        this.updateUI();
        this.listeners.forEach(cb => cb(true));
    }

    handleOffline() {
        this.isOnline = false;
        this.updateUI();
        this.listeners.forEach(cb => cb(false));
    }

    updateUI() {
        if (!this.statusEl) return;

        if (this.isOnline) {
            this.statusEl.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 border border-green-200 transition-all duration-300';
            this.statusDotEl.className = 'w-2 h-2 rounded-full bg-green-500 animate-pulse';
            this.statusTextEl.textContent = '在线';
            this.statusTextEl.className = 'text-xs font-bold text-green-700';
        } else {
            this.statusEl.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 transition-all duration-300';
            this.statusDotEl.className = 'w-2 h-2 rounded-full bg-red-500 animate-pulse';
            this.statusTextEl.textContent = '离线';
            this.statusTextEl.className = 'text-xs font-bold text-red-700';
        }
    }
}

// ==================== IndexedDB 离线缓存管理器 ====================
class OfflineCacheManager {
    constructor() {
        this.dbName = 'FAQueryOfflineDB';
        this.storeName = 'offline_records';
        this.dbVersion = 1;
        this.db = null;

        this.listEl = document.getElementById('offlineList');
        this.emptyEl = document.getElementById('emptyOffline');
        this.badgeEl = document.getElementById('offlineBadge');
        this.countBadgeEl = document.getElementById('offlineCountBadge');
        this.batchSubmitBtn = document.getElementById('batchSubmitBtn');
        this.clearBtn = document.getElementById('clearOfflineBtn');

        this.currentPhoto = null;
        this.currentLocation = null;
        this.html5QrCode = null;
    }

    async init() {
        await this.initDB();
        this.bindEvents();
        this.render();
    }

    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('collectedAt', 'collectedAt', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                }
            };
        });
    }

    bindEvents() {
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => {
                uiManager.confirm('确定要清空所有离线采集记录吗？不可恢复。', () => {
                    this.clearAll();
                }, '清空离线记录');
            });
        }

        if (this.batchSubmitBtn) {
            this.batchSubmitBtn.addEventListener('click', () => this.batchSubmit());
        }
    }

    generateId() {
        return 'offline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async addRecord(record) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const fullRecord = {
                id: this.generateId(),
                facode: record.facode,
                photo: record.photo || null,
                location: record.location || null,
                remark: record.remark || '',
                collectedAt: Date.now(),
                status: 'pending',
                submittedAt: null,
                queryResult: null,
                errorMessage: null
            };

            const request = store.add(fullRecord);
            request.onsuccess = () => {
                this.render();
                resolve(fullRecord);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updateRecord(id, updates) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (!record) {
                    reject(new Error('Record not found'));
                    return;
                }
                const updatedRecord = { ...record, ...updates };
                const putRequest = store.put(updatedRecord);
                putRequest.onsuccess = () => {
                    this.render();
                    resolve(updatedRecord);
                };
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async deleteRecord(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);
            request.onsuccess = () => {
                this.render();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getAllRecords() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();
            request.onsuccess = () => {
                const records = request.result.sort((a, b) => b.collectedAt - a.collectedAt);
                resolve(records);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getPendingRecords() {
        const records = await this.getAllRecords();
        return records.filter(r => r.status === 'pending' || r.status === 'failed');
    }

    async clearAll() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            request.onsuccess = () => {
                this.render();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    getStatusLabel(status) {
        const labels = {
            pending: { text: '待提交', class: 'bg-orange-100 text-orange-700' },
            submitting: { text: '提交中', class: 'bg-blue-100 text-blue-700' },
            success: { text: '已提交', class: 'bg-green-100 text-green-700' },
            failed: { text: '提交失败', class: 'bg-red-100 text-red-700' }
        };
        return labels[status] || { text: status, class: 'bg-gray-100 text-gray-700' };
    }

    async render() {
        if (!this.listEl || !this.emptyEl) return;

        const records = await this.getAllRecords();
        const pendingCount = records.filter(r => r.status === 'pending' || r.status === 'failed').length;

        if (this.badgeEl) {
            if (pendingCount > 0) {
                this.badgeEl.textContent = pendingCount;
                this.badgeEl.classList.remove('hidden');
            } else {
                this.badgeEl.classList.add('hidden');
            }
        }

        if (this.countBadgeEl) {
            this.countBadgeEl.textContent = `${pendingCount} 条待提交`;
        }

        if (this.batchSubmitBtn) {
            this.batchSubmitBtn.disabled = pendingCount === 0 || !networkMonitor.isOnline;
        }

        if (records.length === 0) {
            this.listEl.innerHTML = '';
            this.emptyEl.classList.remove('hidden');
            return;
        }

        this.emptyEl.classList.add('hidden');

        this.listEl.innerHTML = records.map(record => {
            const statusInfo = this.getStatusLabel(record.status);
            const hasPhoto = !!record.photo;
            const hasLocation = !!record.location;

            return `
                <div class="offline-item bg-white border border-gray-100 rounded-lg p-4 hover:shadow-md transition-all duration-200 group"
                     data-id="${record.id}">
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="font-bold text-gray-800 text-lg">${record.facode}</span>
                                <span class="px-2 py-0.5 ${statusInfo.class} text-xs font-bold rounded-full uppercase tracking-wide">
                                    ${statusInfo.text}
                                </span>
                                <span class="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                                    离线采集
                                </span>
                            </div>
                            <div class="flex items-center text-xs text-gray-400 gap-2 mb-1">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span class="font-medium text-amber-600">采集时间: ${this.formatTime(record.collectedAt)}</span>
                            </div>
                            ${record.submittedAt ? `
                            <div class="flex items-center text-xs text-gray-400 gap-2">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                <span>提交时间: ${this.formatTime(record.submittedAt)}</span>
                            </div>
                            ` : ''}
                        </div>
                        <div class="flex items-center gap-1">
                            ${record.status === 'success' && record.queryResult ? `
                            <button onclick="window.offlineCacheManager.showResult('${record.id}')" 
                                class="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition" title="查看结果">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            </button>
                            ` : ''}
                            ${(record.status === 'pending' || record.status === 'failed') ? `
                            <button onclick="window.offlineCacheManager.submitSingle('${record.id}')" 
                                class="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-md transition" title="单独提交">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                            </button>
                            ` : ''}
                            <button onclick="window.offlineCacheManager.deleteRecord('${record.id}')" 
                                class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition opacity-0 group-hover:opacity-100" title="删除">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    ${record.queryResult ? `
                    <div class="mb-3 p-3 bg-green-50 border border-green-100 rounded-lg">
                        <div class="text-xs text-gray-500 uppercase font-semibold mb-1">查询结果</div>
                        <div class="text-xl font-bold text-green-600 font-mono">SN: ${record.queryResult.sn || '未找到'}</div>
                    </div>
                    ` : ''}

                    ${record.errorMessage ? `
                    <div class="mb-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                        <div class="text-xs text-gray-500 uppercase font-semibold mb-1">错误信息</div>
                        <div class="text-sm text-red-600">${record.errorMessage}</div>
                    </div>
                    ` : ''}

                    <div class="flex flex-wrap gap-2 text-xs">
                        ${hasPhoto ? `
                        <span class="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 rounded">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            含照片
                        </span>
                        ` : ''}
                        ${hasLocation ? `
                        <span class="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            ${record.location.address || '位置已记录'}
                        </span>
                        ` : ''}
                        ${record.remark ? `
                        <span class="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 text-gray-700 rounded max-w-full truncate">
                            <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            <span class="truncate">${record.remark}</span>
                        </span>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    async showResult(id) {
        const records = await this.getAllRecords();
        const record = records.find(r => r.id === id);
        if (record && record.queryResult) {
            if (record.queryResult.sn) {
                uiManager.alert(`固定资产编码: ${record.facode}\n序列号: ${record.queryResult.sn}`, '查询结果');
            } else {
                uiManager.alert(`固定资产编码: ${record.facode}\n未找到对应的序列号`, '查询结果');
            }
        }
    }

    async submitSingle(id) {
        if (!networkMonitor.isOnline) {
            uiManager.alert('当前网络不可用，请恢复网络后再试', '无法提交');
            return;
        }

        const records = await this.getAllRecords();
        const record = records.find(r => r.id === id);
        if (!record) return;

        await this.submitOneRecord(record);
    }

    getBaseUrl(ip) {
        if (ip.includes(':')) {
            return `http://${ip}`;
        }
        return `http://${ip}:8080`;
    }

    async submitOneRecord(record) {
        const ip = document.getElementById('ipInput')?.value.trim() || 'localhost';

        try {
            await this.updateRecord(record.id, { status: 'submitting' });

            const headers = connectionManager.getHeaders();
            const baseUrl = this.getBaseUrl(ip);
            const url = `${baseUrl}/api/query.php?facode=${encodeURIComponent(record.facode)}`;

            const response = await fetch(url, { method: 'GET', headers: headers });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const rawError = errorData.error || `HTTP 错误！状态码: ${response.status}`;
                throw new Error(connectionManager.translateError ? connectionManager.translateError(rawError) : rawError);
            }

            const data = await response.json();

            if (data.success) {
                await this.updateRecord(record.id, {
                    status: 'success',
                    submittedAt: Date.now(),
                    queryResult: data.data,
                    errorMessage: null
                });

                if (data.data) {
                    historyManager.add({ facode: record.facode, ip, sn: data.data.sn });
                }

                return true;
            } else {
                throw new Error(data.error || '查询失败');
            }
        } catch (error) {
            let errorMsg = error.message;
            if (error.message.includes('Failed to fetch')) {
                errorMsg = '无法连接到服务器，请检查 IP 和后端状态';
            }

            await this.updateRecord(record.id, {
                status: 'failed',
                submittedAt: Date.now(),
                errorMessage: errorMsg
            });

            return false;
        }
    }

    async batchSubmit() {
        if (!networkMonitor.isOnline) {
            uiManager.alert('当前网络不可用，请恢复网络后再试', '无法提交');
            return;
        }

        const pendingRecords = await this.getPendingRecords();
        if (pendingRecords.length === 0) {
            uiManager.alert('没有待提交的记录', '提示');
            return;
        }

        uiManager.confirm(`确定要提交 ${pendingRecords.length} 条离线采集记录吗？`, async () => {
            this.batchSubmitBtn.disabled = true;
            this.batchSubmitBtn.innerHTML = `
                <svg class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                提交中...
            `;

            let successCount = 0;
            let failCount = 0;

            for (const record of pendingRecords) {
                const success = await this.submitOneRecord(record);
                if (success) {
                    successCount++;
                } else {
                    failCount++;
                }
            }

            this.render();
            this.batchSubmitBtn.innerHTML = `
                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                批量提交
            `;

            uiManager.alert(`批量提交完成\n成功: ${successCount} 条\n失败: ${failCount} 条`, '提交完成');
        }, '批量提交');
    }
}

// ==================== 离线扫码采集管理器 ====================
class OfflineScanManager {
    constructor(offlineCacheManager) {
        this.cacheManager = offlineCacheManager;

        this.modal = document.getElementById('offlineScanModal');
        this.openBtn = document.getElementById('offlineScanBtn');
        this.closeBtn = document.getElementById('closeOfflineScan');
        this.cancelBtn = document.getElementById('cancelOfflineBtn');
        this.saveBtn = document.getElementById('saveOfflineBtn');

        this.facodeInput = document.getElementById('offlineFacode');
        this.remarkInput = document.getElementById('offlineRemark');
        this.collectTimeEl = document.getElementById('offlineCollectTime');

        this.startScannerBtn = document.getElementById('startScannerBtn');
        this.stopScannerBtn = document.getElementById('stopScannerBtn');
        this.scannerContainer = document.getElementById('scannerContainer');
        this.scannerEl = document.getElementById('scanner');

        this.photoInput = document.getElementById('photoInput');
        this.photoPreview = document.getElementById('photoPreview');
        this.photoPreviewContainer = document.getElementById('photoPreviewContainer');
        this.photoPlaceholder = document.getElementById('photoPlaceholder');
        this.removePhotoBtn = document.getElementById('removePhotoBtn');

        this.getLocationBtn = document.getElementById('getLocationBtn');
        this.locationText = document.getElementById('locationText');

        this.html5QrCode = null;
        this.currentPhoto = null;
        this.currentLocation = null;

        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        if (this.openBtn) {
            this.openBtn.addEventListener('click', () => this.openModal());
        }
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closeModal());
        }
        if (this.cancelBtn) {
            this.cancelBtn.addEventListener('click', () => this.closeModal());
        }
        if (this.saveBtn) {
            this.saveBtn.addEventListener('click', () => this.saveRecord());
        }

        if (this.startScannerBtn) {
            this.startScannerBtn.addEventListener('click', () => this.startScanner());
        }
        if (this.stopScannerBtn) {
            this.stopScannerBtn.addEventListener('click', () => this.stopScanner());
        }

        if (this.photoInput) {
            this.photoInput.addEventListener('change', (e) => this.handlePhotoSelect(e));
        }
        if (this.removePhotoBtn) {
            this.removePhotoBtn.addEventListener('click', () => this.removePhoto());
        }

        if (this.getLocationBtn) {
            this.getLocationBtn.addEventListener('click', () => this.getCurrentLocation());
        }
    }

    openModal() {
        if (!networkMonitor.isOnline) {
            uiManager.alert('当前处于离线模式，您采集的数据将保存到本地缓存，网络恢复后可批量提交。', '离线模式提示');
        }

        this.resetForm();
        this.updateCollectTime();
        this.modal.classList.remove('hidden');
        uiManager.showOverlay();
    }

    closeModal() {
        this.stopScanner();
        this.modal.classList.add('hidden');
        uiManager.hideOverlay();
    }

    resetForm() {
        this.facodeInput.value = '';
        this.remarkInput.value = '';
        this.currentPhoto = null;
        this.currentLocation = null;
        this.locationText.textContent = '未获取位置';
        this.photoPreviewContainer.classList.add('hidden');
        this.photoPlaceholder.classList.remove('hidden');
    }

    updateCollectTime() {
        const now = new Date();
        this.collectTimeEl.textContent = now.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    async startScanner() {
        try {
            if (!this.html5QrCode) {
                this.html5QrCode = new Html5Qrcode('scanner');
            }

            this.scannerContainer.classList.remove('hidden');

            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            };

            await this.html5QrCode.start(
                { facingMode: 'environment' },
                config,
                (decodedText) => this.onScanSuccess(decodedText),
                (errorMessage) => {}
            );
        } catch (error) {
            console.error('Scanner error:', error);
            uiManager.alert('无法启动摄像头，请确保已授权摄像头权限。您可以手动输入固定资产编码。', '扫码失败');
        }
    }

    async stopScanner() {
        if (this.html5QrCode) {
            try {
                await this.html5QrCode.stop();
            } catch (e) {}
            this.html5QrCode = null;
        }
        this.scannerContainer.classList.add('hidden');
    }

    onScanSuccess(decodedText) {
        this.facodeInput.value = decodedText.trim();
        this.stopScanner();
        uiManager.alert(`扫码成功：${decodedText}`, '扫码成功');
    }

    handlePhotoSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            this.currentPhoto = e.target.result;
            this.photoPreview.src = this.currentPhoto;
            this.photoPreviewContainer.classList.remove('hidden');
            this.photoPlaceholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }

    removePhoto() {
        this.currentPhoto = null;
        this.photoInput.value = '';
        this.photoPreviewContainer.classList.add('hidden');
        this.photoPlaceholder.classList.remove('hidden');
    }

    getCurrentLocation() {
        if (!navigator.geolocation) {
            uiManager.alert('您的浏览器不支持地理定位', '获取位置失败');
            return;
        }

        this.getLocationBtn.disabled = true;
        this.getLocationBtn.innerHTML = `
            <svg class="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            获取中...
        `;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    address: null
                };

                const lat = position.coords.latitude.toFixed(6);
                const lng = position.coords.longitude.toFixed(6);
                const acc = Math.round(position.coords.accuracy);
                this.locationText.innerHTML = `
                    <span class="text-green-600 font-medium">位置已获取</span><br>
                    <span class="text-gray-600 font-mono text-xs">纬度: ${lat}, 经度: ${lng}</span><br>
                    <span class="text-gray-400 text-xs">精度: ±${acc}米</span>
                `;

                this.getLocationBtn.disabled = false;
                this.getLocationBtn.innerHTML = `
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    重新获取位置
                `;
            },
            (error) => {
                let message = '获取位置失败';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = '用户拒绝了位置请求';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = '位置信息不可用';
                        break;
                    case error.TIMEOUT:
                        message = '获取位置超时';
                        break;
                }
                uiManager.alert(message, '获取位置失败');

                this.getLocationBtn.disabled = false;
                this.getLocationBtn.innerHTML = `
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    获取当前位置
                `;
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    async saveRecord() {
        const facode = this.facodeInput.value.trim();

        if (!facode) {
            uiManager.alert('请输入或扫描固定资产编码', '缺少参数');
            return;
        }

        try {
            await this.cacheManager.addRecord({
                facode: facode,
                photo: this.currentPhoto,
                location: this.currentLocation,
                remark: this.remarkInput.value.trim()
            });

            uiManager.alert(`已保存离线采集记录：${facode}\n网络恢复后可批量提交查询`, '保存成功');
            this.closeModal();
        } catch (error) {
            uiManager.alert('保存失败：' + error.message, '错误');
        }
    }
}

// ==================== UI 管理器 (模态框系统) ====================
class UIManager {
    constructor() {
        this.overlay = document.getElementById('globalOverlay');

        // Confirm Modal Elements
        this.confirmModal = document.getElementById('confirmModal');
        this.confirmTitle = document.getElementById('confirmTitle');
        this.confirmMessage = document.getElementById('confirmMessage');
        this.confirmOkBtn = document.getElementById('confirmOkBtn');
        this.confirmCancelBtn = document.getElementById('confirmCancelBtn');

        // Alert Modal Elements
        this.alertModal = document.getElementById('alertModal');
        this.alertMessage = document.getElementById('alertMessage');
        this.alertOkBtn = document.getElementById('alertOkBtn');

        this.init();
    }

    init() {
        // Bind generic close events
        if (this.confirmCancelBtn) {
            this.confirmCancelBtn.addEventListener('click', () => this.hideConfirm());
        }
        if (this.alertOkBtn) {
            this.alertOkBtn.addEventListener('click', () => this.hideAlert());
        }
    }

    showOverlay() {
        if (this.overlay) this.overlay.classList.remove('hidden');
    }

    hideOverlay() {
        // Only hide if no other modals are open (checked via class logic or simple counter)
        // For simplicity, we manage overlay visibility per modal type in their show/hide methods
        // But to prevent conflicts, we'll force show/hide based on active modals
        if (this.confirmModal.classList.contains('hidden') &&
            this.alertModal.classList.contains('hidden') &&
            document.getElementById('settingsModal').classList.contains('hidden')) {
            if (this.overlay) this.overlay.classList.add('hidden');
        }
    }

    // Custom Confirm Dialog
    confirm(message, onConfirm, title = '确认操作') {
        if (!this.confirmModal) return;

        this.confirmTitle.textContent = title;
        this.confirmMessage.textContent = message;

        // Clean up old listeners
        const newOkBtn = this.confirmOkBtn.cloneNode(true);
        this.confirmOkBtn.parentNode.replaceChild(newOkBtn, this.confirmOkBtn);
        this.confirmOkBtn = newOkBtn;

        this.confirmOkBtn.addEventListener('click', () => {
            this.hideConfirm();
            if (onConfirm) onConfirm();
        });

        this.showOverlay();
        this.confirmModal.classList.remove('hidden');
    }

    hideConfirm() {
        if (this.confirmModal) this.confirmModal.classList.add('hidden');
        this.hideOverlay();
    }

    // Custom Alert Dialog
    alert(message, title = '提示') {
        if (!this.alertModal) return;

        document.getElementById('alertTitle').textContent = title;
        this.alertMessage.textContent = message;

        this.showOverlay();
        this.alertModal.classList.remove('hidden');
    }

    hideAlert() {
        if (this.alertModal) this.alertModal.classList.add('hidden');
        this.hideOverlay();
    }
}

// ==================== 数据库连接管理器 ====================
class ConnectionManager {
    constructor() {
        this.connectionsKey = 'fa_query_connections_v5'; // Key upgrade
        this.activeIdKey = 'fa_query_active_connection_id_v5';

        this.modal = document.getElementById('settingsModal');
        this.openBtn = document.getElementById('settingsBtn');
        this.closeBtn = document.getElementById('closeSettings');

        this.init();
    }

    init() {
        this.ensureDefaultConnection();

        if (this.openBtn) this.openBtn.addEventListener('click', () => this.openConnectionsModal());
        if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.closeModal());
    }

    ensureDefaultConnection() {
        const connections = this.getConnections();
        // Check if default MySQL connection exists
        if (!connections.find(c => c.id === 'default-mysql')) {
            const defaultConn = {
                id: 'default-mysql',
                name: '系统默认数据库 (MySQL)',
                type: 'default', // Special type for internal docker default
                isDefault: true,
                canDelete: false,
                createdAt: new Date().toISOString()
            };
            // Add to start
            connections.unshift(defaultConn);
            this.saveConnections(connections);
        }

        // Ensure an active connection is set
        if (!this.getActiveConnectionId()) {
            this.setActiveConnection('default-mysql');
        }
    }

    getConnections() {
        const stored = localStorage.getItem(this.connectionsKey);
        return stored ? JSON.parse(stored) : [];
    }

    saveConnections(connections) {
        localStorage.setItem(this.connectionsKey, JSON.stringify(connections));
    }

    getActiveConnectionId() {
        return localStorage.getItem(this.activeIdKey);
    }

    setActiveConnection(id) {
        localStorage.setItem(this.activeIdKey, id);
    }

    getActiveConnection() {
        const id = this.getActiveConnectionId();
        const connections = this.getConnections();
        return connections.find(c => c.id === id) || connections[0];
    }

    addConnection(config) {
        const connections = this.getConnections();
        const newConn = {
            id: 'conn-' + Date.now(),
            name: config.name || '新连接',
            type: 'mysql', // Only MySQL supported now
            isDefault: false,
            canDelete: true,
            createdAt: new Date().toISOString(),
            ...config
        };
        connections.push(newConn);
        this.saveConnections(connections);
        return newConn;
    }

    updateConnection(id, config) {
        const connections = this.getConnections();
        const index = connections.findIndex(c => c.id === id);
        if (index !== -1) {
            connections[index] = { ...connections[index], ...config };
            this.saveConnections(connections);
        }
    }

    deleteConnection(id) {
        uiManager.confirm('确定要删除这个连接配置吗？不可恢复。', () => {
            let connections = this.getConnections();
            const conn = connections.find(c => c.id === id);

            if (conn && !conn.canDelete) {
                uiManager.alert('系统默认连接不能删除');
                return;
            }

            connections = connections.filter(c => c.id !== id);
            this.saveConnections(connections);

            if (this.getActiveConnectionId() === id) {
                this.setActiveConnection('default-mysql');
            }

            this.renderConnectionsList();
        }, '删除连接');
    }

    parseConnectionString(connStr) {
        try {
            const mysqlMatch = connStr.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
            if (mysqlMatch) {
                return {
                    type: 'mysql',
                    user: decodeURIComponent(mysqlMatch[1]),
                    pass: decodeURIComponent(mysqlMatch[2]),
                    host: mysqlMatch[3],
                    port: mysqlMatch[4],
                    dbname: mysqlMatch[5]
                };
            }
            throw new Error('仅支持 MySQL 连接字符串 (mysql://user:pass@host:port/dbname)');
        } catch (e) {
            throw new Error('连接字符串解析失败：' + e.message);
        }
    }

    getHeaders() {
        const conn = this.getActiveConnection();
        // Default (Internal Docker MySQL) -> No Headers (Backend uses Env)
        if (!conn || conn.type === 'default') {
            return {};
        }

        // Custom External MySQL
        if (conn.type === 'mysql') {
            return {
                'X-DB-CONNECTION': 'mysql',
                'X-DB-HOST': conn.host || '',
                'X-DB-PORT': conn.port || '3306',
                'X-DB-NAME': conn.dbname || '',
                'X-DB-USER': conn.user || '',
                'X-DB-PASSWORD': conn.pass || ''
            };
        }

        return {};
    }

    getCurrentConnectionName() {
        const conn = this.getActiveConnection();
        return conn ? conn.name : '未知连接';
    }

    openConnectionsModal() {
        this.renderConnectionsList();
        if (this.modal) {
            this.modal.classList.remove('hidden');
            uiManager.showOverlay();
        }
    }

    closeModal() {
        if (this.modal) {
            this.modal.classList.add('hidden');
            uiManager.hideOverlay();
        }
    }

    renderConnectionsList() {
        const connections = this.getConnections();
        const activeId = this.getActiveConnectionId();

        let html = `
            <div class="mb-6">
                <button onclick="window.connectionManager.showConnectionForm()" 
                    class="w-full py-3 px-4 bg-indigo-50 border-2 border-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-100 hover:border-indigo-200 transition-all font-semibold flex items-center justify-center gap-2">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                    新增 MySQL 连接
                </button>
            </div>
            <div class="space-y-3">
        `;

        connections.forEach(conn => {
            const isActive = conn.id === activeId;
            const activeClass = isActive ? 'ring-2 ring-indigo-500 bg-indigo-50/50' : 'border border-gray-100 hover:bg-gray-50';
            const isDefault = conn.type === 'default';

            html += `
                <div class="rounded-lg p-4 transition-all duration-200 ${activeClass}">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <div class="flex items-center gap-3 mb-1">
                                <span class="text-base font-bold text-gray-800">${conn.name}</span>
                                ${isActive ? '<span class="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full">当前使用</span>' : ''}
                            </div>
                            <div class="text-sm text-gray-500 flex items-center gap-2">
                                <span class="uppercase font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs ">${isDefault ? 'SYSTEM' : 'MYSQL'}</span>
                                ${!isDefault ? `<span class="truncate max-w-[200px]">${conn.host}:${conn.port}</span>` : '<span class="text-gray-400 italic">内置容器数据库</span>'}
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            ${!isActive ? `<button onclick="window.connectionManager.handleSetActive('${conn.id}')" class="px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-md transition">启用</button>` : ''}
                            
                            ${!isDefault ? `
                            <button onclick="window.connectionManager.showConnectionForm('${conn.id}')" class="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition" title="编辑">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                            </button>
                            <button onclick="window.connectionManager.deleteConnection('${conn.id}')" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition" title="删除">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                            ` : '<div class="px-2 py-1 text-xs text-gray-400 bg-gray-100 rounded">系统预设</div>'}
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';

        const modalBody = this.modal.querySelector('.modal-body');
        if (modalBody) modalBody.innerHTML = html;
    }

    handleSetActive(id) {
        this.setActiveConnection(id);
        this.renderConnectionsList();
    }

    showConnectionForm(editId = null) {
        const connections = this.getConnections();
        const conn = editId ? connections.find(c => c.id === editId) : null;
        const isEdit = !!conn;

        // Default connection cannot be edited, but logic prevents regular users from reaching here via UI for default conn

        const html = `
            <form id="connectionForm" class="space-y-5" novalidate>
                <div class="flex items-center gap-2 text-gray-500 mb-2 cursor-pointer hover:text-gray-800 transition-colors w-max" onclick="window.connectionManager.renderConnectionsList()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                    <span class="text-sm font-medium">返回连接列表</span>
                </div>

                <!-- 生产环境警告 -->
                <div class="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-md">
                    <div class="flex">
                        <div class="flex-shrink-0">
                            <svg class="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <div class="ml-3">
                            <p class="text-sm text-amber-700">
                                <strong>注意：</strong>新增连接需配置 <span class="font-bold underline">Public (公网) 可访问的生产环境数据库</span>。配置错误可能导致无法连接，建议仅限高级技术人员尝试。
                            </p>
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1.5">连接名称</label>
                    <input type="text" id="connName" value="${conn ? conn.name : ''}" placeholder="例如：生产环境 MySQL" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow">
                </div>
                
                <input type="hidden" id="connType" value="mysql">

                <div class="bg-blue-50/50 rounded-lg p-4 border border-blue-100">
                    <label class="block text-xs font-bold text-blue-700 uppercase mb-2">快速填充</label>
                    <div class="flex gap-2">
                        <input type="text" id="connString" placeholder="mysql://user:pass@host:port/dbname" class="flex-1 px-3 py-1.5 text-sm border border-blue-200 rounded placeholder-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-500">
                        <button type="button" onclick="window.connectionManager.parseAndFillForm()" class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded font-medium hover:bg-blue-700 transition">解析</button>
                    </div>
                </div>

                <div id="mysqlFields" class="space-y-4 animate-fade-in">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">主机地址</label>
                            <input type="text" id="connHost" value="${conn && conn.host || ''}" placeholder="127.0.0.1" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">端口</label>
                            <input type="text" id="connPort" value="${conn && conn.port || '3306'}" placeholder="3306" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                            <input type="text" id="connUser" value="${conn && conn.user || ''}" placeholder="root" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">密码</label>
                            <input type="password" id="connPass" value="${conn && conn.pass || ''}" placeholder="密码" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">数据库名</label>
                        <input type="text" id="connDbname" value="${conn && conn.dbname || ''}" placeholder="fixed_assets" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                    </div>
                </div>

                <div class="flex gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onclick="window.connectionManager.renderConnectionsList()" class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">取消</button>
                    <button type="button" onclick="window.connectionManager.saveConnectionFromForm('${editId || ''}')" class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-bold shadow-sm">${isEdit ? '保存修改' : '创建连接'}</button>
                </div>
            </form>
        `;

        const modalBody = this.modal.querySelector('.modal-body');
        if (modalBody) modalBody.innerHTML = html;

        const form = document.getElementById('connectionForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveConnectionFromForm(editId);
            });
        }
    }

    parseAndFillForm() {
        const connString = document.getElementById('connString').value.trim();
        if (!connString) {
            uiManager.alert('请输入连接字符串');
            return;
        }

        try {
            const parsed = this.parseConnectionString(connString);

            // Auto fill
            if (parsed.type === 'mysql') {
                document.getElementById('connHost').value = parsed.host || '';
                document.getElementById('connPort').value = parsed.port || '3306';
                document.getElementById('connDbname').value = parsed.dbname || '';
                document.getElementById('connUser').value = parsed.user || '';
                document.getElementById('connPass').value = parsed.pass || '';
            }
            uiManager.alert('解析成功，表单已自动填充', '操作成功');
        } catch (e) {
            uiManager.alert(e.message, '解析错误');
        }
    }

    // 辅助：翻译常见数据库错误
    translateError(errorMsg) {
        if (!errorMsg) return '未知错误';
        if (errorMsg.includes('Access denied')) return '数据库访问被拒绝：用户名或密码错误';
        if (errorMsg.includes('Unknown database')) return '数据库不存在：请检查数据库名称';
        if (errorMsg.includes('Connection refused')) return '连接被拒绝：请检查主机地址和端口';
        if (errorMsg.includes('timed out')) return '连接超时：服务器无响应';
        if (errorMsg.includes('getaddrinfo failed')) return '主机名解析失败：请检查主机地址';
        return errorMsg;
    }

    saveConnectionFromForm(editId) {
        const name = document.getElementById('connName').value.trim();
        const type = 'mysql';

        // 1. 基础校验
        if (!name) {
            uiManager.alert('请输入连接名称', '校验失败');
            return;
        }

        const config = { name, type };
        config.host = document.getElementById('connHost').value.trim();
        config.port = document.getElementById('connPort').value.trim();
        config.dbname = document.getElementById('connDbname').value.trim();
        config.user = document.getElementById('connUser').value.trim();
        config.pass = document.getElementById('connPass').value.trim();

        // 2. 详细字段校验
        if (!config.host) {
            uiManager.alert('请输入主机地址 (IP 或域名)', '校验失败');
            return;
        }

        if (!config.port) {
            uiManager.alert('请输入端口号', '校验失败');
            return;
        }
        const portNum = parseInt(config.port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            uiManager.alert('端口号必须是 1 到 65535 之间的数字', '校验失败');
            return;
        }

        if (!config.user) {
            uiManager.alert('请输入数据库用户名', '校验失败');
            return;
        }

        if (!config.dbname) {
            uiManager.alert('请输入数据库名称', '校验失败');
            return;
        }

        // 密码允许为空，但通常给个提醒? 不，视具体情况，这里不做强制。

        if (editId) {
            this.updateConnection(editId, config);
            uiManager.alert('连接配置已更新', '操作成功');
        } else {
            this.addConnection(config);
            uiManager.alert('新连接已创建', '操作成功');
        }

        this.renderConnectionsList();
    }
}

// ==================== 查询历史管理器 ====================
class HistoryManager {
    constructor() {
        this.storageKey = 'fa_query_history_v5'; // New storage key
        this.maxItems = 20;
        this.listEl = document.getElementById('historyList');
        this.emptyEl = document.getElementById('emptyHistory');
        this.clearBtn = document.getElementById('clearHistoryBtn');

        this.init();
    }

    init() {
        this.render();

        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => {
                uiManager.confirm('确定要清空所有历史记录吗？不可恢复。', () => {
                    this.clear();
                }, '清空历史');
            });
        }

        if (this.listEl) {
            this.listEl.addEventListener('click', (e) => {
                const item = e.target.closest('.history-item');
                if (!item) return;

                if (e.target.closest('.delete-btn')) {
                    e.stopPropagation();
                    const timestamp = parseInt(item.dataset.timestamp);
                    uiManager.confirm('确定要删除这条历史记录吗？', () => {
                        this.remove(timestamp);
                    }, '删除记录');
                    return;
                }

                const facode = item.dataset.facode;
                const ip = item.dataset.ip;
                const facodeInput = document.getElementById('facodeInput');
                const ipInput = document.getElementById('ipInput');
                const form = document.getElementById('queryForm');

                if (facodeInput && ipInput && form) {
                    facodeInput.value = facode;
                    ipInput.value = ip;
                    form.dispatchEvent(new Event('submit'));
                }
            });
        }
    }

    getHistory() {
        const stored = localStorage.getItem(this.storageKey);
        return stored ? JSON.parse(stored) : [];
    }

    add(record) {
        const history = this.getHistory();
        record.timestamp = Date.now();
        record.connectionName = connectionManager.getCurrentConnectionName();
        history.unshift(record);
        if (history.length > this.maxItems) history.pop();

        localStorage.setItem(this.storageKey, JSON.stringify(history));
        this.render();
    }

    remove(timestamp) {
        let history = this.getHistory();
        history = history.filter(h => h.timestamp !== timestamp);
        localStorage.setItem(this.storageKey, JSON.stringify(history));
        this.render();
    }

    clear() {
        localStorage.removeItem(this.storageKey);
        this.render();
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
    }

    render() {
        const history = this.getHistory();

        if (!this.listEl || !this.emptyEl) return;

        if (history.length === 0) {
            this.listEl.innerHTML = '';
            this.emptyEl.classList.remove('hidden');
            return;
        }

        this.emptyEl.classList.add('hidden');

        this.listEl.innerHTML = history.map(h => `
            <div class="history-item bg-white border border-gray-100 rounded-lg p-4 hover:shadow-md transition-all duration-200 cursor-pointer group"
                 data-facode="${h.facode}" data-ip="${h.ip}" data-timestamp="${h.timestamp}">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="font-bold text-gray-800 text-lg">${h.facode}</span>
                            <span class="px-2 py-0.5 ${h.sn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'} text-xs font-bold rounded-full uppercase tracking-wide">
                                ${h.sn ? '已找到' : '未找到'}
                            </span>
                        </div>
                        ${h.sn ? `<div class="text-sm font-mono text-gray-600 mb-2">SN: ${h.sn}</div>` : ''}
                        <div class="flex items-center text-xs text-gray-400 gap-2">
                            <span>${this.formatTime(h.timestamp)}</span>
                            ${h.connectionName ? `<span class="bg-gray-50 px-1 rounded text-gray-500">${h.connectionName}</span>` : ''}
                        </div>
                    </div>
                    <button class="delete-btn text-gray-300 hover:text-red-500 hover:bg-red-50 p-2 rounded transition-all opacity-0 group-hover:opacity-100" title="删除">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `).join('');
    }
}

// ==================== 查询管理器 ====================
class QueryManager {
    constructor() {
        this.form = document.getElementById('queryForm');
        this.resultBox = document.getElementById('resultBox');
        this.errorBox = document.getElementById('errorBox');
        this.loadingEl = document.getElementById('loading');
        this.curlCommand = document.getElementById('curlCommand');

        this.init();
    }

    getBaseUrl(ip) {
        if (ip.includes(':')) {
            return `http://${ip}`;
        }
        return `http://${ip}:8080`;
    }

    init() {
        if (this.form) {
            this.form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.performQuery();
            });

            const facodeInput = document.getElementById('facodeInput');
            const ipInput = document.getElementById('ipInput');
            if (facodeInput) facodeInput.addEventListener('input', () => this.updateCurlCommand());
            if (ipInput) ipInput.addEventListener('input', () => this.updateCurlCommand());
        }
        this.updateCurlCommand();
    }

    updateCurlCommand() {
        const facode = document.getElementById('facodeInput')?.value || 'FA001';
        const ip = document.getElementById('ipInput')?.value || 'localhost';
        const headers = connectionManager.getHeaders();

        const baseUrl = this.getBaseUrl(ip);
        let curlCmd = `curl "${baseUrl}/api/query.php?facode=${facode}"`;
        Object.entries(headers).forEach(([key, value]) => {
            if (value) curlCmd += ` \\\n  -H "${key}: ${value}"`;
        });

        if (this.curlCommand) this.curlCommand.textContent = curlCmd;
    }

    async performQuery() {
        const facode = document.getElementById('facodeInput')?.value.trim();
        const ip = document.getElementById('ipInput')?.value.trim() || 'localhost';

        // 校验
        if (!ip) {
            uiManager.alert('请输入服务器 IP 地址或域名', '缺少参数');
            return;
        }

        if (!facode) {
            uiManager.alert('请输入固定资产编码', '参数错误');
            return;
        }

        this.showLoading();
        this.hideError();
        this.hideResult();

        try {
            const headers = connectionManager.getHeaders();
            const baseUrl = this.getBaseUrl(ip);
            const url = `${baseUrl}/api/query.php?facode=${encodeURIComponent(facode)}`;

            const response = await fetch(url, { method: 'GET', headers: headers });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const rawError = errorData.error || `HTTP 错误！状态码: ${response.status}`;
                const translatedError = connectionManager.translateError ? connectionManager.translateError(rawError) : rawError;
                throw new Error(translatedError);
            }
            const data = await response.json();

            if (data.success && data.data) {
                this.showResult(data.data);
                historyManager.add({ facode, ip, sn: data.data.sn });
            } else if (data.success && !data.data) {
                this.showError('未找到该固定资产编码对应的序列号');
                historyManager.add({ facode, ip, sn: null });
            } else {
                const rawError = data.error || '查询失败';
                const translatedError = connectionManager.translateError ? connectionManager.translateError(rawError) : rawError;
                throw new Error(translatedError);
            }
        } catch (error) {
            let errorMsg = '查询出错：';
            if (error.message.includes('Failed to fetch')) {
                errorMsg += '无法连接到服务器，请检查 IP 和后端状态';
            } else {
                errorMsg += error.message;
            }
            this.showError(errorMsg);
        } finally {
            this.hideLoading();
        }
    }

    showLoading() {
        if (this.loadingEl) this.loadingEl.classList.remove('hidden');
    }

    hideLoading() {
        if (this.loadingEl) this.loadingEl.classList.add('hidden');
    }

    showResult(data) {
        if (!this.resultBox) return;

        const resultContent = document.getElementById('resultContent');
        if (resultContent) {
            resultContent.innerHTML = `
                <div class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-6 border border-emerald-100 shadow-sm animate-fade-in">
                    <div class="flex items-center justify-between mb-4">
                        <span class="text-sm font-bold text-emerald-600 uppercase tracking-widest">查询结果</span>
                        <span class="bg-emerald-200 text-emerald-800 text-xs px-2 py-1 rounded-full font-bold">成功</span>
                    </div>
                    <div class="space-y-4">
                        <div>
                            <div class="text-xs text-gray-500 uppercase font-semibold mb-1">固定资产编码</div>
                            <div class="text-2xl font-bold text-gray-800 font-mono">${data.facode}</div>
                        </div>
                        <div class="h-px bg-emerald-200"></div>
                        <div>
                            <div class="text-xs text-gray-500 uppercase font-semibold mb-1">序列号 (SN)</div>
                            <div class="text-3xl font-extrabold text-emerald-600 font-mono tracking-wide selection:bg-emerald-200">${data.sn}</div>
                        </div>
                    </div>
                </div>
            `;
        }
        this.resultBox.classList.remove('hidden');
    }

    hideResult() {
        if (this.resultBox) this.resultBox.classList.add('hidden');
    }

    showError(message) {
        if (!this.errorBox) return;
        const errorMessage = document.getElementById('errorMessage');
        if (errorMessage) errorMessage.textContent = message;
        this.errorBox.classList.remove('hidden');
    }

    hideError() {
        if (this.errorBox) this.errorBox.classList.add('hidden');
    }
}

// ==================== 初始化 ====================
let connectionManager;
let historyManager;
let queryManager;
let uiManager;
let networkMonitor;
let offlineCacheManager;
let offlineScanManager;

document.addEventListener('DOMContentLoaded', async () => {
    uiManager = new UIManager();
    networkMonitor = new NetworkMonitor();
    connectionManager = new ConnectionManager();
    historyManager = new HistoryManager();
    queryManager = new QueryManager();
    offlineCacheManager = new OfflineCacheManager();
    await offlineCacheManager.init();
    offlineScanManager = new OfflineScanManager(offlineCacheManager);

    // 网络状态变化时更新批量提交按钮状态
    networkMonitor.onStatusChange(() => {
        offlineCacheManager.render();
    });

    // EXPOSE TO WINDOW for inline onclick handlers
    window.connectionManager = connectionManager;
    window.uiManager = uiManager;
    window.queryManager = queryManager;
    window.offlineCacheManager = offlineCacheManager;
    window.networkMonitor = networkMonitor;
});
