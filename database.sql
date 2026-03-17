-- ============================================================
-- Bus Tracking System — Full Schema + Seed Data
-- Database: bus_tracking
-- ============================================================

CREATE DATABASE IF NOT EXISTS `bus_tracking`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `bus_tracking`;

-- ------------------------------------------------------------
-- TABLE: buses
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `buses` (
  `bus_id`       INT              NOT NULL AUTO_INCREMENT,
  `bus_name`     VARCHAR(50)      NOT NULL,
  `route`        VARCHAR(100)     NOT NULL,
  `latitude`     DECIMAL(10,8)   DEFAULT 14.59950000,
  `longitude`    DECIMAL(11,8)   DEFAULT 120.98420000,
  `last_updated` TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_active`    TINYINT(1)       NOT NULL DEFAULT 0,
  PRIMARY KEY (`bus_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- TABLE: drivers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `drivers` (
  `driver_id`  INT          NOT NULL AUTO_INCREMENT,
  `username`   VARCHAR(50)  NOT NULL,
  `password`   VARCHAR(255) NOT NULL,
  `full_name`  VARCHAR(100) NOT NULL,
  `bus_id`     INT          NOT NULL,
  PRIMARY KEY (`driver_id`),
  UNIQUE KEY `uq_drivers_username` (`username`),
  CONSTRAINT `fk_drivers_bus` FOREIGN KEY (`bus_id`) REFERENCES `buses` (`bus_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- TABLE: students
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `students` (
  `student_id`    INT          NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(50)  NOT NULL,
  `password`      VARCHAR(255) NOT NULL,
  `full_name`     VARCHAR(100) NOT NULL,
  `student_id_no` VARCHAR(30)  DEFAULT NULL,
  PRIMARY KEY (`student_id`),
  UNIQUE KEY `uq_students_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- TABLE: location_history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `location_history` (
  `id`         INT             NOT NULL AUTO_INCREMENT,
  `bus_id`     INT             NOT NULL,
  `latitude`   DECIMAL(10,8)   NOT NULL,
  `longitude`  DECIMAL(11,8)   NOT NULL,
  `recorded_at` TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lh_bus_id` (`bus_id`),
  CONSTRAINT `fk_lh_bus` FOREIGN KEY (`bus_id`) REFERENCES `buses` (`bus_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SEED DATA
-- ============================================================

-- Buses
INSERT INTO `buses` (`bus_name`, `route`, `latitude`, `longitude`, `is_active`) VALUES
  ('Bus 1', 'Route A - North Campus',  14.59950000, 120.98420000, 0),
  ('Bus 2', 'Route B - South Gate',    14.59800000, 120.98250000, 0),
  ('Bus 3', 'Route C - East Wing',     14.60100000, 120.98600000, 0);

-- Drivers  (password = "password123")
-- Hash: $2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi
INSERT INTO `drivers` (`username`, `password`, `full_name`, `bus_id`) VALUES
  ('driver1', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Alex Mendoza', 1),
  ('driver2', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Ben Reyes',   2),
  ('driver3', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Carlo Lim',    3);

-- Students  (password = "student123")
-- Hash: $2y$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LzTFufVMX2i
INSERT INTO `students` (`username`, `password`, `full_name`, `student_id_no`) VALUES
  ('student1', '$2y$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LzTFufVMX2i', 'Juan Santos',  '2024-0001'),
  ('student2', '$2y$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LzTFufVMX2i', 'Maria Reyes',  '2024-0002');
