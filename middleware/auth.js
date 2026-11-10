const jwt = require('jsonwebtoken');

// Middleware to verify JWT Token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1]; // Extract token from "Bearer <TOKEN>"

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied. Malformed token.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_default_jwt_secret');
        req.user = decoded; // Attaches user payload (user_id, role, full_name) to request
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
};

module.exports = { verifyToken };