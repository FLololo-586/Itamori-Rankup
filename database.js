const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('./src/utils/logger');

class DatabaseManager {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, 'rankup.db'), (err) => {
            if (err) {
                logger.error('Failed to open database:', err);
                throw err;
            }
            logger.info('Database connection established');
            
            // Enable WAL mode for better concurrency
            this.db.run('PRAGMA journal_mode = WAL', (err) => {
                if (err) {
                    logger.error('Failed to enable WAL mode:', err);
                    throw err;
                }
                
                // Initialize database schema
                this.initializeDatabase()
                    .then(() => {
                        logger.info('Database schema initialized successfully');
                    })
                    .catch((err) => {
                        logger.error('Failed to initialize database schema:', err);
                        throw err; // Re-throw to prevent the app from starting without a database
                    });
            });
        });
    }

    initializeDatabase() {
        return new Promise((resolve, reject) => {
            // Use sqlite3's serialize to ensure operations happen in sequence
            this.db.serialize(() => {
                // Enable foreign keys
                this.db.run('PRAGMA foreign_keys = ON', (err) => {
                    if (err) {
                        logger.error('Failed to enable foreign keys:', err);
                        return reject(err);
                    }

                    // Create tables
                    const createTables = [
                        `CREATE TABLE IF NOT EXISTS users (
                            userId TEXT PRIMARY KEY,
                            currentRank INTEGER DEFAULT 1,
                            lastRankUp INTEGER,
                            totalMessages INTEGER DEFAULT 0,
                            totalVoiceMinutes INTEGER DEFAULT 0,
                            joinDate INTEGER,
                            lastMessageDate INTEGER,
                            createdAt INTEGER DEFAULT (strftime('%s', 'now')),
                            updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
                        )`,
                        `CREATE TABLE IF NOT EXISTS message_history (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            userId TEXT,
                            timestamp INTEGER,
                            createdAt INTEGER,
                            FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
                        )`,
                        `CREATE TABLE IF NOT EXISTS voice_sessions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            userId TEXT,
                            joinTime INTEGER,
                            leaveTime INTEGER,
                            duration INTEGER,
                            createdAt INTEGER,
                            FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
                        )`,
                        `CREATE TABLE IF NOT EXISTS blacklist (
                            userId TEXT PRIMARY KEY,
                            reason TEXT,
                            adminId TEXT,
                            createdAt INTEGER,
                            updatedAt INTEGER,
                            FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
                        )`,
                        'CREATE INDEX IF NOT EXISTS idx_message_history_user_id ON message_history(userId)',
                        'CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id ON voice_sessions(userId)',
                        'CREATE INDEX IF NOT EXISTS idx_blacklist_user_id ON blacklist(userId)'
                    ];

                    // Execute each SQL statement in sequence
                    const executeStatements = (index) => {
                        if (index >= createTables.length) {
                            // After creating tables, run migrations
                            this.runMigrations()
                                .then(() => {
                                    logger.debug('Database schema initialized successfully');
                                    resolve();
                                })
                                .catch(reject);
                            return;
                        }

                        this.db.run(createTables[index], (err) => {
                            if (err) {
                                logger.error(`Failed to execute statement ${index + 1}:`, err);
                                return reject(err);
                            }
                            executeStatements(index + 1);
                        });
                    };

                    executeStatements(0);
                });
            });
        });
    }

    /**
     * Execute a series of SQL queries in sequence
     * @param {string[]} queries - Array of SQL queries to execute
     * @param {Function} callback - Callback with (error, results)
     */
    series(queries, callback) {
        const results = [];
        let index = 0;
        
        const next = () => {
            if (index >= queries.length) {
                return callback(null, results);
            }
            
            const query = queries[index++];
            this.db.run(query, function(err) {
                if (err) return callback(err);
                results.push(this);
                next();
            });
        };
        
        next();
    }
    
    /**
     * Add a user to the blacklist
     * @param {string} userId - The ID of the user to blacklist
     * @param {string} adminId - The ID of the admin who blacklisted the user
     * @param {string} reason - The reason for blacklisting
     * @returns {Promise<Object>} The result of the operation
     */
    /**
     * Get a blacklisted user by ID
     * @param {string} userId - The ID of the user to check
     * @returns {Promise<Object|null>} The blacklist entry or null if not found
     */
    getBlacklistedUser(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM blacklist WHERE userId = ?',
                [userId],
                (err, row) => {
                    if (err) {
                        logger.error(`Error getting blacklisted user ${userId}:`, err);
                        return resolve(null);
                    }
                    resolve(row || null);
                }
            );
        });
    }

    /**
     * Add a user to the blacklist
     * @param {string} userId - The ID of the user to blacklist
     * @param {string} adminId - The ID of the admin who blacklisted the user
     * @param {string} reason - The reason for blacklisting
     * @returns {Promise<Object>} The result of the operation
     */
    addToBlacklist(userId, adminId, reason) {
        const now = Math.floor(Date.now() / 1000);
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO blacklist (userId, reason, adminId, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(userId) DO UPDATE SET
                    reason = excluded.reason,
                    adminId = excluded.adminId,
                    updatedAt = excluded.updatedAt`,
                [userId, reason, adminId, now, now],
                function(err) {
                    if (err) {
                        logger.error(`Error adding user ${userId} to blacklist:`, err);
                        return reject(err);
                    }
                    resolve({ changes: this.changes });
                }
            );
        });
    }

    // Run database migrations to handle schema changes
    async runMigrations() {
        return new Promise((resolve, reject) => {
            // First, ensure the users table exists
            this.db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    userId TEXT PRIMARY KEY,
                    currentRank INTEGER DEFAULT 1,
                    totalMessages INTEGER DEFAULT 0,
                    totalVoiceMinutes INTEGER DEFAULT 0,
                    joinDate INTEGER,
                    lastMessageDate INTEGER,
                    lastRankUp INTEGER,
                    createdAt INTEGER DEFAULT (strftime('%s', 'now')),
                    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `, (err) => {
                if (err) {
                    logger.error('Error ensuring users table exists:', err);
                    return reject(err);
                }
                
                // Create message_history table with correct schema if it doesn't exist
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS message_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT,
                        timestamp INTEGER,
                        createdAt INTEGER,
                        FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
                    )
                `, (err) => {
                    if (err) {
                        logger.error('Error ensuring message_history table exists:', err);
                        return reject(err);
                    }
                    
                    // Check if message_history has a messageCount column that needs to be removed
                    this.db.all("PRAGMA table_info(message_history)", (err, columns) => {
                        if (err) {
                            logger.error('Error checking message_history schema:', err);
                            return reject(err);
                        }
                        
                        const hasMessageCount = columns.some(col => col.name === 'messageCount');
                        if (hasMessageCount) {
                            logger.info('Detected old message_history schema, creating new table...');
                            
                            // Create a backup of the old table
                            this.db.series([
                                'BEGIN TRANSACTION',
                                'ALTER TABLE message_history RENAME TO message_history_old',
                                `CREATE TABLE message_history (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    userId TEXT,
                                    timestamp INTEGER,
                                    createdAt INTEGER,
                                    FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
                                )`,
                                'INSERT INTO message_history (id, userId, timestamp, createdAt) SELECT id, userId, timestamp, createdAt FROM message_history_old',
                                'DROP TABLE message_history_old',
                                'COMMIT'
                            ], (err) => {
                                if (err) {
                                    logger.error('Error migrating message_history table:', err);
                                    this.db.run('ROLLBACK');
                                    return reject(err);
                                }
                                logger.info('Successfully migrated message_history table');
                                resolve();
                            });
                        } else {
                            logger.debug('message_history table schema is up to date');
                            resolve();
                        }
                    });
                });
            });
        });
    }
    
    // Blacklist management methods
    addToBlacklist(userId, adminId, reason = 'No reason provided') {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);
            this.db.run(
                `INSERT INTO blacklist (userId, reason, adminId, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(userId) DO UPDATE SET 
                    reason = excluded.reason,
                    adminId = excluded.adminId,
                    updatedAt = excluded.updatedAt`,
                [userId, reason, adminId, now, now],
                function(err) {
                    if (err) {
                        logger.error(`Error adding user ${userId} to blacklist:`, err);
                        return reject(err);
                    }
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            );
        });
    }

    removeFromBlacklist(userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM blacklist WHERE userId = ?',
                [userId],
                function(err) {
                    if (err) {
                        logger.error(`Error removing user ${userId} from blacklist:`, err);
                        return reject(err);
                    }
                    resolve({ changes: this.changes });
                }
            );
        });
    }

    isBlacklisted(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT 1 FROM blacklist WHERE userId = ?',
                [userId],
                (err, row) => {
                    if (err) {
                        logger.error(`Error checking if user ${userId} is blacklisted:`, err);
                        return resolve(false);
                    }
                    resolve(!!row);
                }
            );
        });
    }

    getBlacklist() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT b.* 
                 FROM blacklist b
                 ORDER BY b.createdAt DESC`,
                [],
                (err, rows) => {
                    if (err) {
                        logger.error('Error getting blacklist:', err);
                        return resolve([]);
                    }
                    resolve(rows || []);
                }
            );
        });
    }

    /**
     * Réinitialise toutes les statistiques des utilisateurs à 0
     * @returns {Promise<number>} Nombre d'utilisateurs réinitialisés
     */
    async resetAllUserStats() {
        return new Promise((resolve, reject) => {
            const db = this.db; // Store reference to maintain context
            let userCount = 0;
            
            // Start a transaction
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Reset all user stats to 0
                db.run(
                    `UPDATE users SET 
                        totalMessages = 0,
                        totalVoiceMinutes = 0,
                        currentRank = 1,
                        updatedAt = ?`,
                    [Date.now()],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            logger.error('Erreur lors de la réinitialisation des statistiques des utilisateurs :', err);
                            return reject(err);
                        }
                        
                        userCount = this.changes;
                        
                        // Clear message history
                        db.run('DELETE FROM message_history', function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                logger.error('Erreur lors de la suppression de l\'historique des messages :', err);
                                return reject(err);
                            }
                            
                            // Clear voice sessions
                            db.run('DELETE FROM voice_sessions', function(err) {
                                if (err) {
                                    db.run('ROLLBACK');
                                    logger.error('Erreur lors de la suppression des sessions vocales :', err);
                                    return reject(err);
                                }
                                
                                // Commit the transaction
                                db.run('COMMIT', function(err) {
                                    if (err) {
                                        logger.error('Erreur lors du commit de la transaction :', err);
                                        return reject(err);
                                    }
                                    
                                    logger.info(`Toutes les statistiques ont été réinitialisées pour ${userCount} utilisateurs`);
                                    resolve(userCount);
                                });
                            });
                        });
                    }
                );
            });
        });
    }

    // User management methods
    getUser(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM users WHERE userId = ?',
                [userId],
                (err, row) => {
                    if (err) {
                        logger.error(`Error getting user ${userId}:`, err);
                        return reject(err);
                    }
                    resolve(row || null);
                }
            );
        });
    }

    createUser(userId, joinDate) {
        return new Promise((resolve, reject) => {
            const now = Date.now();
            const db = this.db; // Store reference to avoid scope issues
            
            // First try to insert the user
            db.run(
                `INSERT OR IGNORE INTO users (userId, currentRank, joinDate, lastMessageDate, createdAt, updatedAt) 
                 VALUES (?, 1, ?, ?, ?, ?)`,
                [userId, joinDate, now, now, now],
                function(err) {
                    if (err) {
                        logger.error(`Error creating user ${userId}:`, err);
                        return reject(err);
                    }
                    
                    // Now update the updatedAt timestamp
                    db.run(
                        `UPDATE users SET updatedAt = ? WHERE userId = ?`,
                        [now, userId],
                        (err) => {
                            if (err) {
                                logger.error(`Error updating user ${userId}:`, err);
                                return reject(err);
                            }
                            
                            // Finally, get the user data to return
                            db.get(
                                'SELECT * FROM users WHERE userId = ?',
                                [userId],
                                (err, row) => {
                                    if (err) {
                                        logger.error(`Error getting user ${userId}:`, err);
                                        return reject(err);
                                    }
                                    logger.debug(`Created or updated user ${userId}`);
                                    resolve(row);
                                }
                            );
                        }
                    );
                }
            );
        });
    }

    // Message tracking methods
    addMessage(userId) {
        return this.addMessages(userId, 1);
    }
    
    /**
     * Add multiple messages for a user in a single operation
     * @param {string} userId - The Discord user ID
     * @param {number} count - Number of messages to add
     * @returns {Promise<boolean>} True if successful
     */
    addMessages(userId, count = 1) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000); // Convert to Unix timestamp in seconds
            
            // Use a transaction to ensure data consistency
            this.db.serialize(() => {
                // Start transaction
                this.db.run('BEGIN TRANSACTION');
                
                // Create user if not exists and update message count in a single operation
                this.db.run(
                    `INSERT OR IGNORE INTO users 
                     (userId, currentRank, totalMessages, totalVoiceMinutes, joinDate, lastMessageDate, createdAt, updatedAt) 
                     VALUES (?, 1, 0, 0, ?, ?, ?, ?)`,
                    [userId, now, now, now, now],
                    function(err) {
                        if (err) {
                            this.db.run('ROLLBACK');
                            logger.error(`Error ensuring user ${userId} exists:`, err);
                            return reject(err);
                        }
                        
                        // Update the message count
                        this.db.run(
                            'UPDATE users SET totalMessages = totalMessages + ?, lastMessageDate = ?, updatedAt = ? WHERE userId = ?',
                            [count, now, now, userId],
                            function(err) {
                                if (err) {
                                    this.db.run('ROLLBACK');
                                    logger.error(`Error updating message count for user ${userId}:`, err);
                                    return reject(err);
                                }
                                
                                // Insert a single summary record for the batch of messages
                                // We don't store messageCount in the database, just the timestamp
                                this.db.run(
                                    'INSERT INTO message_history (userId, timestamp, createdAt) VALUES (?, ?, ?)',
                                    [userId, now, now],
                                    function(err) {
                                        if (err) {
                                            this.db.run('ROLLBACK');
                                            logger.error(`Error adding message history for user ${userId}:`, err);
                                            return reject(err);
                                        }
                                        
                                        // Commit the transaction
                                        this.db.run('COMMIT', (err) => {
                                            if (err) {
                                                this.db.run('ROLLBACK');
                                                logger.error(`Error committing transaction for user ${userId}:`, err);
                                                return reject(err);
                                            }
                                            
                                            logger.debug(`Added ${count} messages for user ${userId}`);
                                            resolve(true);
                                        });
                                    }.bind(this)
                                );
                            }.bind(this)
                        );
                    }.bind(this)
                );
            });
        });
    }

    // Voice tracking methods
    startVoiceSession(userId) {
        return new Promise((resolve, reject) => {
            const now = Date.now();
            this.db.get(
                `INSERT INTO voice_sessions (userId, joinTime, createdAt) 
                 VALUES (?, ?, ?)
                 RETURNING id`,
                [userId, now, now],
                function(err, row) {
                    if (err) {
                        logger.error(`Error starting voice session for user ${userId}:`, err);
                        return reject(err);
                    }
                    
                    if (!row || !row.id) {
                        const error = new Error('Failed to get session ID');
                        logger.error(error.message);
                        return reject(error);
                    }
                    
                    logger.debug(`Started voice session for user ${userId} with ID ${row.id}`);
                    resolve(row.id);
                }
            );
        });
    }

    endVoiceSession(sessionId) {
        return new Promise((resolve, reject) => {
            const now = Date.now();
            
            // First, get the session
            this.db.get('SELECT * FROM voice_sessions WHERE id = ?', [sessionId], (err, session) => {
                if (err) {
                    logger.error(`Error getting voice session ${sessionId}:`, err);
                    return reject(err);
                }
                
                if (!session) {
                    logger.warn(`Voice session ${sessionId} not found`);
                    return resolve(null);
                }
                
                const duration = Math.max(0, Math.floor((now - session.joinTime) / 60000)); // in minutes, ensure non-negative
                
                // Use a transaction to ensure both updates succeed or fail together
                this.db.serialize(() => {
                    this.db.run('BEGIN TRANSACTION');
                    
                    // Update the voice session
                    this.db.run(
                        `UPDATE voice_sessions 
                         SET leaveTime = ?, 
                             duration = ?,
                             updatedAt = ? 
                         WHERE id = ?`,
                        [now, duration, now, sessionId],
                        function(err) {
                            if (err) {
                                return this.db.run('ROLLBACK', () => {
                                    logger.error(`Error updating voice session ${sessionId}:`, err);
                                    reject(err);
                                });
                            }
                            
                            // Update user's total voice minutes
                            this.db.run(
                                `UPDATE users 
                                 SET totalVoiceMinutes = totalVoiceMinutes + ?,
                                     updatedAt = ?
                                 WHERE userId = ?`,
                                [duration, now, session.userId],
                                function(err) {
                                    if (err) {
                                        return this.db.run('ROLLBACK', () => {
                                            logger.error(`Error updating user ${session.userId} voice minutes:`, err);
                                            reject(err);
                                        });
                                    }
                                    
                                    this.db.run('COMMIT', (err) => {
                                        if (err) {
                                            return this.db.run('ROLLBACK', () => {
                                                logger.error('Error committing transaction:', err);
                                                reject(err);
                                            });
                                        }
                                        
                                        logger.debug(`Ended voice session ${sessionId} for user ${session.userId} (${duration} minutes)`);
                                        resolve(duration);
                                    });
                                }.bind(this)
                            );
                        }.bind(this)
                    );
                });
            });
        });
    }

    /**
     * Add voice time to a user's total
     * @param {string} userId - The ID of the user
     * @param {number} minutes - Number of minutes to add
     * @returns {Promise<boolean>} True if successful
     */
    addVoiceTime(userId, minutes) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);
            
            // First, ensure the user exists
            this.db.run(
                `INSERT OR IGNORE INTO users (userId, currentRank, totalMessages, totalVoiceMinutes, joinDate, lastMessageDate, createdAt, updatedAt)
                 VALUES (?, 1, 0, 0, ?, ?, ?, ?)`,
                [userId, now, now, now, now],
                (err) => {
                    if (err) {
                        logger.error(`Error ensuring user ${userId} exists:`, err);
                        return reject(err);
                    }
                    
                    // Now update the voice time
                    this.db.run(
                        `UPDATE users 
                         SET totalVoiceMinutes = totalVoiceMinutes + ?,
                             updatedAt = ?
                         WHERE userId = ?`,
                        [minutes, now, userId],
                        function(err) {
                            if (err) {
                                logger.error(`Error updating voice time for user ${userId}:`, err);
                                return reject(err);
                            }
                            
                            logger.debug(`Added ${minutes} minutes of voice time to user ${userId}`);
                            resolve(true);
                        }
                    );
                }
            );
        });
    }

    // Get user statistics
    getUserStats(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    u.*,
                    COALESCE((SELECT COUNT() FROM message_history WHERE userId = u.userId), 0) as messageCount
                FROM users u
                WHERE u.userId = ?`,
                [userId],
                (err, row) => {
                    if (err) {
                        logger.error(`Error getting stats for user ${userId}:`, err);
                        return reject(err);
                    }
                    
                    if (!row) {
                        logger.warn(`No stats found for user ${userId}`);
                        return resolve(null);
                    }
                    
                    // Use the totalVoiceMinutes from the users table (updated by endVoiceSession)
                    // and messageCount from the query result
                    resolve(row);
                }
            );
        });
    }

    /**
     * Update a user's rank in the database
     * @param {string} userId - The Discord user ID
     * @param {string} guildId - The Discord guild ID (unused, kept for backward compatibility)
     * @param {number} newRank - The new rank ID
     * @returns {Promise<boolean>} True if successful
     */
    /**
     * Update a user's rank (now handled by Discord roles, but we still track lastRankUp)
     * @param {string} userId - The Discord user ID
     * @param {string} guildId - The Discord guild ID (unused)
     * @param {number} newRank - The new rank ID (unused)
     * @returns {Promise<boolean>} True if successful
     */
    updateUserRank(userId, guildId, newRank) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);
            this.db.run(
                `UPDATE users 
                 SET lastRankUp = ?,
                     updatedAt = ?
                 WHERE userId = ?`,
                [now, now, userId],
                function(err) {
                    if (err) {
                        logger.error('Error updating user lastRankUp:', err);
                        return reject(err);
                    }
                    logger.debug(`Updated lastRankUp for user ${userId}`);
                    resolve(true);
                }
            );
        });
    }
}

// Export a single instance of the database manager
const dbManager = new DatabaseManager();

// Handle process termination to close the database connection properly
process.on('SIGINT', () => {
    try {
        dbManager.db.close();
        logger.info('Database connection closed');
    } catch (error) {
        logger.error('Error closing database connection:', error);
    } finally {
        process.exit(0);
    }
});

// Export the DatabaseManager class and the instance
module.exports = {
    DatabaseManager,
    dbManager
};
