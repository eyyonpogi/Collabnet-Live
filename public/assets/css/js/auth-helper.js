// Global JWT Fetch Wrapper
window.authFetch = async function(url, options = {}) {
    const token = localStorage.getItem('token');

    // Automatically attach Authorization header
    options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };

    const response = await fetch(url, options);

    // If server returns 401 or 403, clear storage and bounce to login
    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/index.html';
        return response;
    }

    return response;
};

// Global Page Auth Guard (runs on page load)
document.addEventListener('DOMContentLoaded', () => {
    const isLoginPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
    const isRegisterPage = window.location.pathname.endsWith('register.html');
    const token = localStorage.getItem('token');

    if (!token && !isLoginPage && !isRegisterPage) {
        window.location.href = '/index.html';
    }
});