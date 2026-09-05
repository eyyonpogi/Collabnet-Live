<?php
// Step up one folder level to access config/db.php
require_once '../config/db.php';

$lgu_email    = 'vinzons_partner@vinzons.gov.ph';
$lgu_password = 'lgu123'; // Default password for LGU Admin
$full_name    = 'LGU Vinzons Coordinator';
$role         = 'Agency Admin';

// 1. Ensure LGU Vinzons exists in the 'agencies' table
$agency_id = null;
$check_agency = pg_query_params($conn, "SELECT agency_id FROM agencies WHERE agency_name = $1", array('LGU Vinzons'));

if ($check_agency && pg_num_rows($check_agency) > 0) {
    $agency_row = pg_fetch_assoc($check_agency);
    $agency_id  = $agency_row['agency_id'];
} else {
    // Insert LGU Vinzons agency record
    $insert_agency_sql = "INSERT INTO agencies (agency_name, agency_type, contact_person, contact_email) 
                          VALUES ($1, $2, $3, $4) RETURNING agency_id";
    $insert_agency_res = pg_query_params($conn, $insert_agency_sql, array(
        'LGU Vinzons',
        'Local Government Unit',
        $full_name,
        $lgu_email
    ));
    
    if ($insert_agency_res) {
        $agency_row = pg_fetch_assoc($insert_agency_res);
        $agency_id  = $agency_row['agency_id'];
    } else {
        die("<h3 style='color: red;'>Failed to register LGU Vinzons in agencies table.</h3>");
    }
}

// 2. Check if LGU Vinzons Admin user already exists
$check_user = pg_query_params($conn, "SELECT user_id FROM users WHERE email = $1", array($lgu_email));

if ($check_user && pg_num_rows($check_user) > 0) {
    echo "<h3 style='color: orange;'>LGU Vinzons Partner account already exists!</h3>";
    echo "<p>Email: <strong>$lgu_email</strong></p>";
} else {
    $hashed_password = password_hash($lgu_password, PASSWORD_BCRYPT);
    $is_verified = 'TRUE';
    $verification_status = 'Approved';

    $insert_user_sql = "INSERT INTO users (full_name, email, password, role, agency_id, is_verified, verification_status) 
                       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING user_id";
    $insert_user_res = pg_query_params($conn, $insert_user_sql, array(
        $full_name,
        $lgu_email,
        $hashed_password,
        $role,
        $agency_id,
        $is_verified,
        $verification_status
    ));

    if ($insert_user_res) {
        echo "<h3 style='color: green;'>LGU Vinzons Partner Account Successfully Created!</h3>";
        echo "<ul>";
        echo "<li><strong>Email / Identification:</strong> $lgu_email</li>";
        echo "<li><strong>Password:</strong> $lgu_password</li>";
        echo "<li><strong>Role:</strong> Agency Admin</li>";
        echo "<li><strong>Linked Agency ID:</strong> $agency_id (LGU Vinzons)</li>";
        echo "</ul>";
        echo "<a href='../index.php'>Go to Portal Sign In</a>";
    } else {
        echo "<h3 style='color: red;'>Failed to create LGU partner account.</h3>";
    }
}
?>