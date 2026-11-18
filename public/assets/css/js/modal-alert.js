// ============================================================================
// Global CollabNet Styled Popup Modal (Replaces native browser window.alert)
// ============================================================================
(function () {
    const alertQueue = [];
    let isShowing = false;

    function detectModalTheme(message) {
        const text = String(message || '').toLowerCase();
        if (
            text.includes('success') ||
            text.includes('submitted') ||
            text.includes('approved') ||
            text.includes('logged') ||
            text.includes('completed') ||
            text.includes('verified')
        ) {
            return {
                title: 'Success',
                icon: 'bi-check-circle-fill',
                iconBg: 'bg-success bg-opacity-10 text-success',
                btnClass: 'btn-success'
            };
        }
        if (
            text.includes('error') ||
            text.includes('failed') ||
            text.includes('invalid') ||
            text.includes('unable') ||
            text.includes('exceeds') ||
            text.includes('denied') ||
            text.includes('incorrect')
        ) {
            return {
                title: 'Action Required',
                icon: 'bi-exclamation-triangle-fill',
                iconBg: 'bg-danger bg-opacity-10 text-danger',
                btnClass: 'btn-danger'
            };
        }
        return {
            title: 'CollabNet Notice',
            icon: 'bi-info-circle-fill',
            iconBg: 'bg-primary bg-opacity-10 text-primary',
            btnClass: 'btn-primary'
        };
    }

    function ensureModalElement() {
        let modalEl = document.getElementById('cnGlobalAlertModal');
        if (modalEl) return modalEl;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="modal fade" id="cnGlobalAlertModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
                <div class="modal-dialog modal-dialog-centered" style="max-width: 420px;">
                    <div class="modal-content border-0 shadow-lg rounded-4 p-2">
                        <div class="modal-body text-center pt-4 pb-3 px-4">
                            <div id="cnGlobalAlertIconWrap" class="rounded-circle d-inline-flex align-items-center justify-content-center mb-3" style="width: 56px; height: 56px;">
                                <i id="cnGlobalAlertIcon" class="bi bi-check-circle-fill fs-2"></i>
                            </div>
                            <h5 id="cnGlobalAlertTitle" class="fw-bold text-dark mb-2">Notice</h5>
                            <p id="cnGlobalAlertMessage" class="text-muted small mb-0" style="line-height: 1.55; white-space: pre-line;"></p>
                        </div>
                        <div class="modal-footer border-top-0 justify-content-center pt-1 pb-3">
                            <button type="button" id="cnGlobalAlertOkBtn" class="btn btn-primary fw-bold px-5 rounded-3" data-bs-dismiss="modal">
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(wrapper.firstElementChild);
        modalEl = document.getElementById('cnGlobalAlertModal');

        modalEl.addEventListener('hidden.bs.modal', () => {
            isShowing = false;
            processNextAlert();
        });

        return modalEl;
    }

    function processNextAlert() {
        if (isShowing || alertQueue.length === 0) return;

        const { message, onClose } = alertQueue.shift();
        const modalEl = ensureModalElement();
        const theme = detectModalTheme(message);

        const iconWrap = document.getElementById('cnGlobalAlertIconWrap');
        const iconEl = document.getElementById('cnGlobalAlertIcon');
        const titleEl = document.getElementById('cnGlobalAlertTitle');
        const msgEl = document.getElementById('cnGlobalAlertMessage');
        const okBtn = document.getElementById('cnGlobalAlertOkBtn');

        iconWrap.className = `rounded-circle d-inline-flex align-items-center justify-content-center mb-3 ${theme.iconBg}`;
        iconEl.className = `bi ${theme.icon} fs-2`;
        titleEl.textContent = theme.title;
        msgEl.textContent = message;
        okBtn.className = `btn ${theme.btnClass} fw-bold px-5 rounded-3`;

        if (typeof onClose === 'function') {
            modalEl.addEventListener('hidden.bs.modal', onClose, { once: true });
        }

        if (window.bootstrap && window.bootstrap.Modal) {
            isShowing = true;
            const instance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
            instance.show();
        }
    }

    // Helper for modal + redirect flows (e.g., register.html)
    window.showPopupModal = function (message, onClose) {
        alertQueue.push({ message, onClose });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', processNextAlert, { once: true });
        } else {
            processNextAlert();
        }
    };

    // Override native browser alert() globally
    window.alert = function (message) {
        window.showPopupModal(message);
    };
})();