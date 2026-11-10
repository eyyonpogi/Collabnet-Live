const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'collabnet_secret_key_2026';

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ success: false, message: 'Access denied. Malformed token format.' });
    }

    const token = parts[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error('JWT Verification Failed:', err.message);
        return res.status(401).json({ success: false, message: 'Invalid or expired session token.' });
    }
};

const requireAuth = verifyToken;

const requireRole = (role) => {
    return (req, res, next) => {
        if (!req.user || (req.user.role || '').toLowerCase() !== role.toLowerCase()) {
            return res.status(403).json({ 
                success: false, 
                message: `Access denied. Authorized ${role} access required.` 
            });
        }
        next();
    };
};

module.exports = { 
    verifyToken, 
    requireAuth, 
    requireRole 
};