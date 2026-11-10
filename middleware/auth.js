const jwt = require('jsonwebtoken');

// 1. Verify JWT Token
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
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
};

// 2. Alias for requireAuth (so both requireAuth and verifyToken work)
const requireAuth = verifyToken;

// 3. Middleware to check specific user roles (e.g. Admin, Student, LGU)
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