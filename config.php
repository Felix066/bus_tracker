<?php
// ============================================================
// config.php — DB credentials, connection helper, session bootstrap
// ============================================================

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');
define('DB_NAME', getenv('DB_NAME') ?: 'bus_tracking');

/**
 * Returns a MySQLi connection. Dies with a JSON error on failure.
 */
function getDBConnection(): mysqli
{
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    if ($conn->connect_error) {
        header('Content-Type: application/json');
        http_response_code(500);
        die(json_encode(['error' => 'Database connection failed: ' . $conn->connect_error]));
    }
    $conn->set_charset('utf8mb4');
    return $conn;
}

// Start session once for every page that includes config.php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
