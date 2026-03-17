<?php
// ============================================================
// logout.php — Destroy session and redirect to correct login page
// ============================================================
require_once 'config.php';

$role = $_SESSION['role'] ?? '';
session_destroy();

if ($role === 'driver') {
    header('Location: driver_login.php');
} elseif ($role === 'student') {
    header('Location: student_login.php');
} else {
    header('Location: student_login.php');
}
exit;
