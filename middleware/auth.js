const jwt = require('jsonwebtoken');

// 1. Core Token Verification Middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied. Malformed token.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_default_jwt_secret');
        req.user = decoded; // Contains user_id, role, full_name
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session token.' });
    }
};

// 2. Alias for requireAuth
const requireAuth = verifyToken;

// 3. Role Checking Middleware
const requireRole = (role) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
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