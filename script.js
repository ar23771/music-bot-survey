/**
 * ============================================================================
 * 系統運作原理與架構說明 (System Architecture)
 * ============================================================================
 * 1. 前端 (Client): 
 * 負責收集使用者資料，並產生一組唯一的「瀏覽器身分證 (UUID)」。
 * 利用 localStorage 紀錄這組 ID 與「是否已提交」的狀態，防止重複填寫。
 * * 2. 傳輸 (Fetch API):
 * 使用 POST 方法將資料傳送給 Google Apps Script (GAS)。
 * 關鍵點：因為跨網域 (Cross-Origin) 安全限制，必須使用 mode: 'no-cors'。
 * * 3. 後端 (GAS):
 * 接收資料後，先檢查 UUID 是否已存在試算表中。若無，則寫入；若有，則拒絕。
 * ============================================================================
 */

// 請替換為您的 GAS Web App 部署 URL (請確認這是「新版本」的網址)
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxiVrXBRaWDxZZRxDAqOCn-dMeJ6ZPr6JyAktUx5Deo9-zGg17jm6s66rxJmAxZ5mI0TA/exec';

// Storage 前綴，避免與其他網站應用衝突，保持 localStorage 整潔
const STORAGE_PREFIX = 'music_survey_';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('musicSurveyForm');
    const statusElement = document.getElementById('submissionStatus');

    // --- 步驟 1: 初始化檢查 ---
    // 網頁一載入，立刻檢查這台瀏覽器是否已經提交過問卷
    checkIfSubmitted();

    // 初始化音頻監聽 (保持原本功能)
    initAudioPersistence();

    // --- 步驟 2: 表單提交監聽 ---
    form.addEventListener('submit', async (e) => {
        // 阻止瀏覽器預設的跳頁行為，改用 JavaScript 處理
        e.preventDefault();

        // **[新增功能]** 步驟 1: 自訂 Checkbox 群組驗證 (確保複選題至少選一項)
        if (!validateCheckboxGroups()) {
            return; // 如果 Checkbox 驗證失敗，停止提交
        }

        // 步驟 2: 原生表單驗證 (檢查 HTML 中的 required 屬性，主要用於 Radio Button)
        if (!form.checkValidity()) {
            showStatus('請完成所有必填項目', 'error');
            form.reportValidity(); // 觸發瀏覽器原生的提示框
            return;
        }

        try {
            // 建立要傳送的資料物件
            const formData = new FormData(form);

            // --- 資料增強 (Data Enrichment) ---
            // 1. 自動紀錄提交時間 (ISO 格式)
            formData.append('submission_time', new Date().toISOString());

            // 3. 關鍵：加入瀏覽器唯一識別碼 (UUID)
            formData.append('uuid', getOrCreateUUID());

            // 鎖定按鈕，防止使用者連點造成重複發送
            showStatus('提交中...', 'info');
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = '處理中...';

            // --- 步驟 3: 發送請求 (Fetch) ---
            const response = await fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                // 【原理說明】mode: 'no-cors'
                // 瀏覽器基於安全理由，預設不允許讀取跨網域 (Google 網域) 的回傳內容。
                // 設定 no-cors 告訴瀏覽器：「我只要負責送出資料就好，我不在乎回傳什麼內容」。
                // 代價是：我們無法知道後端是否報錯 (如 403, 500)，只能假設送出即成功。
                mode: 'no-cors',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                // 將 FormData 轉換為 URL 查詢字串格式 (key=value&key2=value2...)
                body: new URLSearchParams(formData).toString()
            });

            // --- 步驟 4: 處理回應 ---
            // 在 no-cors 模式下，成功的請求會回傳 type: 'opaque' (不透明)
            if (response.type === 'opaque') {
                showStatus('提交成功！感謝您的參與', 'success');
                form.reset();

                // 清除暫存的音頻進度
                clearSurveyStorage();

                // 【關鍵防護】標記此瀏覽器已完成問卷
                localStorage.setItem(`${STORAGE_PREFIX}completed`, 'true');

                // 延遲一秒後鎖定畫面，讓使用者看到成功訊息
                setTimeout(() => {
                    lockForm();
                }, 1500);
            } else {
                // 理論上 no-cors 不會跑到這裡，除非網路層級出錯
                throw new Error('伺服器返回異常響應');
            }

        } catch (error) {
            console.error('提交失敗:', error);
            // 恢復按鈕讓使用者可以重試
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = false;
            submitBtn.textContent = '提交問卷';
            showStatus(`提交失敗: 請檢查網路後重試`, 'error');
        }
    });

    // --- 輔助函式區域 (Helper Functions) ---

    /**
     * **[新增功能]**
     * 自訂驗證函式：檢查必填的 Checkbox 群組是否至少有一項被勾選。
     * @returns {boolean} 如果所有必選群組都滿足要求，返回 true。
     */
    function validateCheckboxGroups() {
        const requiredGroups = [
            { name: 'styles_soft_relaxing', message: '請至少選擇一項您感到放鬆的音樂風格。' },
            { name: 'styles_intense_emotional', message: '請至少選擇一項您感到不舒服的音樂風格。' }
        ];

        for (const group of requiredGroups) {
            // 只選擇 input[type="checkbox"] 來排除 "其他" 的文字輸入框
            const checkboxes = form.querySelectorAll(`input[type="checkbox"][name="${group.name}"]`);
            const isChecked = Array.from(checkboxes).some(checkbox => checkbox.checked);

            if (!isChecked) {
                showStatus(group.message, 'error');

                // 捲動到該區塊，提供更好的用戶體驗
                const questionBlock = form.querySelector(`input[name="${group.name}"]`)?.closest('.question-block');
                if (questionBlock) {
                    questionBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }

                return false;
            }
        }
        return true;
    }


    // 顯示狀態訊息
    function showStatus(message, type) {
        statusElement.textContent = message;
        statusElement.className = type; // 對應 CSS 的 .success 或 .error

        if (type === 'success') {
            // 成功訊息不自動消失，讓使用者確認
        }
    }

    // 清除音頻進度相關的 localStorage
    function clearSurveyStorage() {
        Object.keys(localStorage).forEach(key => {
            // 只清除 music_survey_audio_ 開頭的紀錄，保留 UUID 和 completed 狀態
            if (key.startsWith(`${STORAGE_PREFIX}audio_`)) {
                localStorage.removeItem(key);
            }
        });
    }

    /**
     * 【防重複核心 1】產生或讀取 UUID
     * 原理：如果 localStorage 裡沒有 ID，就算出一組新的亂數 ID 並存起來。
     * 之後每次進來都會讀到同一組 ID，除非使用者清除瀏覽器資料。
     */
    function getOrCreateUUID() {
        const key = `${STORAGE_PREFIX}user_uuid`;
        let uuid = localStorage.getItem(key);

        if (!uuid) {
            // 簡易 UUID v4 產生演算法
            uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
            localStorage.setItem(key, uuid);
        }
        return uuid;
    }

    /**
     * 【防重複核心 2】檢查鎖定狀態
     * 頁面載入時執行，如果發現 'completed' 標記，直接鎖住表單。
     */
    function checkIfSubmitted() {
        if (localStorage.getItem(`${STORAGE_PREFIX}completed`) === 'true') {
            lockForm();
            showStatus('您已完成此問卷，請勿重複填寫。', 'info');
        }
    }

    /**
     * 【UI 控制】鎖定表單
     * 將所有輸入框設為 disabled，並降低透明度，視覺上告知不可編輯。
     */
    function lockForm() {
        const inputs = form.querySelectorAll('input, button, textarea');
        inputs.forEach(input => input.disabled = true);
        form.style.opacity = '0.6'; // 讓表單變灰
        form.style.pointerEvents = 'none'; // 禁止滑鼠點擊

        // 確保狀態訊息依然清晰可見
        statusElement.style.opacity = '1';
        statusElement.style.fontWeight = 'bold';
    }

    // 音頻播放進度保存 (維持原樣)
    function initAudioPersistence() {
        const audios = document.querySelectorAll('audio');
        audios.forEach(audio => {
            const src = audio.currentSrc || audio.querySelector('source')?.src;
            if (!src) return;

            const fileName = src.substring(src.lastIndexOf('/') + 1);
            const storageKey = `${STORAGE_PREFIX}audio_${fileName}`;

            const savedTime = localStorage.getItem(storageKey);
            if (savedTime) {
                audio.currentTime = parseFloat(savedTime);
            }

            audio.addEventListener('timeupdate', () => {
                if (!audio.paused) {
                    localStorage.setItem(storageKey, audio.currentTime.toString());
                }
            });

            audio.addEventListener('ended', () => {
                localStorage.removeItem(storageKey);
            });
        });
    }
});