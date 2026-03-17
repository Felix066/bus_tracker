<?php
// Generate fresh hashes and update DB directly
$studentHash = password_hash('student123', PASSWORD_BCRYPT);
$driverHash  = password_hash('password123', PASSWORD_BCRYPT);

// Verify they work
echo "student123 verify: " . (password_verify('student123', $studentHash) ? 'OK' : 'FAIL') . PHP_EOL;
echo "password123 verify: " . (password_verify('password123', $driverHash) ? 'OK' : 'FAIL') . PHP_EOL;

// Connect and update
$conn = new mysqli('localhost', 'root', '', 'bus_tracking');
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error . PHP_EOL);
}

$conn->query("UPDATE students SET password = '$studentHash'");
echo "Students updated: " . $conn->affected_rows . " rows" . PHP_EOL;

$conn->query("UPDATE drivers SET password = '$driverHash'");
echo "Drivers updated: " . $conn->affected_rows . " rows" . PHP_EOL;

// Verify what's now in DB
$r = $conn->query("SELECT username, password FROM students");
while ($row = $r->fetch_assoc()) {
    $ok = password_verify('student123', $row['password']);
    echo "Check {$row['username']}: " . ($ok ? '✅ login will work' : '❌ STILL broken') . PHP_EOL;
}

$conn->close();
echo "Done!" . PHP_EOL;
?>
