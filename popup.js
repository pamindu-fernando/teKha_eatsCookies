// popup.js - Enhanced with status feedback

// Simple function to extract registrable domain (eTLD+1)
function getRegistrableDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    // Handle common multi-part TLDs – extend as needed
    const twoPartTLDs = ['co.uk', 'com.au', 'gov.uk', 'co.jp', 'com.br', 'co.nz'];
    const lastTwo = parts.slice(-2).join('.');
    if (twoPartTLDs.includes(lastTwo)) {
        return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
}

async function getCurrentTab() {
    let queryOptions = { active: true, currentWindow: true };
    let [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}

function escapeHTML(str) {
    return str.replace(/[&<>"]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
    });
}

function setStatus(message, isError = false) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.style.color = isError ? 'red' : 'black';
    }
    console.log(message);
}

async function refreshCookies() {
    const tab = await getCurrentTab();
    const url = tab.url;
    const urlObj = new URL(url);
    document.getElementById('siteInfo').innerHTML = `Cookies for: <strong>${urlObj.hostname}</strong> (scoped to this URL)`;

    chrome.cookies.getAll({ url: url }, function (cookies) {
        const container = document.getElementById('cookieList');
        container.innerHTML = '';
        if (!cookies || cookies.length === 0) {
            container.innerHTML = '<p>No cookies found for this site.</p>';
            return;
        }
        cookies.forEach(cookie => {
            const div = document.createElement('div');
            div.className = 'cookie-item';
            div.innerHTML = `
                <div class="cookie-name">${escapeHTML(cookie.name)}</div>
                <div class="cookie-value">${escapeHTML(cookie.value)}</div>
                <small>Domain: ${cookie.domain || '&lt;host-only&gt;'} | Path: ${cookie.path} | Secure: ${cookie.secure} | HttpOnly: ${cookie.httpOnly} | SameSite: ${cookie.sameSite || 'unspecified'}</small>
                <br><button data-name="${escapeHTML(cookie.name)}" data-domain="${escapeHTML(cookie.domain || '')}" data-path="${escapeHTML(cookie.path)}" data-secure="${cookie.secure}" class="deleteBtn">Delete</button>
            `;
            container.appendChild(div);
        });

        document.querySelectorAll('.deleteBtn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                const name = this.dataset.name;
                const domain = this.dataset.domain;
                const path = this.dataset.path;
                const secure = this.dataset.secure === 'true';
                deleteCookie(name, domain, path, secure);
            });
        });
    });
}

function deleteCookie(name, domain, path, secure) {
    getCurrentTab().then(tab => {
        const currentUrl = new URL(tab.url);
        let url;
        if (domain) {
            let cleanDomain = domain.replace(/^\./, '');
            let protocol = secure ? 'https:' : (currentUrl.protocol || 'http:');
            url = `${protocol}//${cleanDomain}${path}`;
        } else {
            url = `${currentUrl.origin}${path}`;
        }

        chrome.cookies.remove({ name: name, url: url }, function (details) {
            if (chrome.runtime.lastError) {
                setStatus(`Error deleting ${name}: ${chrome.runtime.lastError.message}`, true);
            } else {
                setStatus(`Deleted ${name}`);
                refreshCookies();
            }
        });
    });
}

function exportCookies() {
    getCurrentTab().then(tab => {
        const url = tab.url;
        chrome.cookies.getAll({ url: url }, function (cookies) {
            const dataStr = JSON.stringify(cookies, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `cookies_${new URL(url).hostname}.json`;
            a.click();
            setStatus(`Exported ${cookies.length} cookies`);
        });
    });
}

function importCookies(event) {
    const file = event.target.files[0];
    if (!file) {
        setStatus('No file selected.', true);
        return;
    }

    setStatus(`Reading file: ${file.name}...`);

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const cookies = JSON.parse(e.target.result);
            if (!Array.isArray(cookies)) throw new Error('Invalid format: root is not an array');

            setStatus(`Parsed ${cookies.length} cookies from file. Checking domain compatibility...`);

            getCurrentTab().then(tab => {
                const currentUrl = new URL(tab.url);
                const currentHost = currentUrl.hostname;
                const currentRegDomain = getRegistrableDomain(currentHost);

                let importedCount = 0;
                let skippedCount = 0;
                let errorCount = 0;

                // Use Promise to track completion? We'll just set cookies and then refresh after a delay.
                cookies.forEach(cookie => {
                    // Determine cookie's effective domain
                    const cookieDomain = cookie.domain ? cookie.domain.replace(/^\./, '') : currentHost;
                    const cookieRegDomain = getRegistrableDomain(cookieDomain);

                    if (cookieRegDomain === currentRegDomain) {
                        // Construct URL for setting
                        let setUrl;
                        if (cookie.domain) {
                            let cleanDomain = cookie.domain.replace(/^\./, '');
                            let protocol = cookie.secure ? 'https:' : 'http:';
                            setUrl = `${protocol}//${cleanDomain}${cookie.path || '/'}`;
                        } else {
                            setUrl = `${currentUrl.origin}${cookie.path || '/'}`;
                        }

                        // Set cookie
                        chrome.cookies.set({
                            url: setUrl,
                            name: cookie.name,
                            value: cookie.value,
                            domain: cookie.domain,
                            path: cookie.path,
                            secure: cookie.secure || false,
                            httpOnly: cookie.httpOnly || false,
                            sameSite: cookie.sameSite || 'unspecified',
                            expirationDate: cookie.expirationDate
                        }, function (result) {
                            if (chrome.runtime.lastError) {
                                console.error('Error setting cookie:', cookie.name, chrome.runtime.lastError);
                                errorCount++;
                                setStatus(`Error setting ${cookie.name}: ${chrome.runtime.lastError.message}`, true);
                            } else {
                                importedCount++;
                                setStatus(`Imported ${importedCount} cookies...`);
                            }
                        });
                    } else {
                        skippedCount++;
                        console.log(`Skipped cookie for different domain: ${cookie.domain} (current: ${currentRegDomain})`);
                    }
                });

                // Wait a bit then refresh and show summary
                setTimeout(() => {
                    refreshCookies();
                    setStatus(`Import complete: ${importedCount} imported, ${skippedCount} skipped, ${errorCount} errors.`);
                }, 1500); // Increased delay to allow most sets to complete
            });
        } catch (err) {
            setStatus('Error parsing file: ' + err.message, true);
        }
    };
    reader.onerror = function () {
        setStatus('Failed to read file.', true);
    };
    reader.readAsText(file);

    // Clear the file input so selecting the same file again triggers change
    event.target.value = '';
}

document.addEventListener('DOMContentLoaded', function () {
    refreshCookies();

    document.getElementById('refreshBtn').addEventListener('click', refreshCookies);
    document.getElementById('exportBtn').addEventListener('click', exportCookies);
    document.getElementById('importBtn').addEventListener('click', function () {
        document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', importCookies);
});