<?php
require_once 'config.php';

// Test DB connection
try {
    $conn = getDBConnection();
    echo "✅ DB connected OK\n<br>";

    // Fetch student1
    $stmt = $conn->prepare('SELECT username, password FROM students WHERE username = ?');
    $u = 'student1';
    $stmt->bind_param('s', $u);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if ($row) {
        echo "✅ User found: " . $row['username'] . "\n<br>";
        echo "Hash in DB: " . $row['password'] . "\n<br>";

        $testPass = 'student123';
        $result = password_verify($testPass, $row['password']);
        echo "password_verify('student123', hash) = " . ($result ? '✅ TRUE — Login will work!' : '❌ FALSE — Hash mismatch!') . "\n<br>";
    } else {
        echo "❌ User 'student1' NOT FOUND in DB!\n<br>";
    }
    $conn->close();
} catch (Exception $e) {
    echo "❌ Error: " . $e->getMessage() . "\n<br>";
}
?>
