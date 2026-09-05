<?php
require_once '../config/db.php';

$admin_email    = 'admin@ollcf.edu.ph';
$admin_password = 'admin123'; // Change this password if needed
$full_name      = 'Extension Director';
$role           = 'Admin';

// Check if admin already exists
$check_sql = "SELECT user_id FROM users WHERE email = $1";
$check_res = pg_query_params($conn, $check_sql, array($admin_email));

if (pg_num_rows($check_res) > 0) {
    echo "<h3 style='color: orange;'>Admin account already exists!</h3>";
    echo "<p>Email: <strong>$admin_email</strong></p>";
} else {
    $hashed_password = password_hash($admin_password, PASSWORD_BCRYPT);
    
    $insert_sql = "INSERT INTO users (full_name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING user_id";
    $insert_res = pg_query_params($conn, $insert_sql, array($full_name, $admin_email, $hashed_password, $role));

    if ($insert_res) {
        echo "<h3 style='color: green;'>Admin Account Successfully Created!</h3>";
        echo "<ul>";
        echo "<li><strong>Email / Identification:</strong> $admin_email</li>";
        echo "<li><strong>Password:</strong> $admin_password</li>";
        echo "<li><strong>Role:</strong> Admin</li>";
        echo "</ul>";
        echo "<a href='index.php'>Go to Portal Sign In</a>";
    } else {
        echo "<h3 style='color: red;'>Failed to create admin account.</h3>";
    }
}
?>