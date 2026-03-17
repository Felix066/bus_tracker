<?php
// Temporary fix script — run once then delete
$driverHash  = password_hash('password123', PASSWORD_BCRYPT);
$studentHash = password_hash('student123',  PASSWORD_BCRYPT);

echo "Driver hash:  " . $driverHash  . "\n";
echo "Student hash: " . $studentHash . "\n";

require_once 'config.php';
$conn = getDBConnection();

$s1 = $conn->prepare("UPDATE drivers  SET password = ? WHERE 1");
$s1->bind_param('s', $driverHash);
$s1->execute();
$s1->close();

$s2 = $conn->prepare("UPDATE students SET password = ? WHERE 1");
$s2->bind_param('s', $studentHash);
$s2->execute();
$s2->close();

$conn->close();
echo "\nDone! All passwords updated. Delete this file now.\n";
