
const { Client, GatewayIntentBits, Collection, Options } = require('discord.js');
const { readdirSync } = require('fs');
const path = require('path');
const config = require('./config.json');
const { DatabaseManager } = require('./database');
const logger = require('./src/utils/logger');
const Scheduler = require('./src/utils/scheduler');

// Load configuration
if (!config.token) {
    logger.error('Missing token in config.json. Please add your bot token.');
    process.exit(1);
}

/**
 * Custom Discord client with additional functionality for the RankUp bot
 */
class RankUpClient extends Client {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMembers
            ],
            // Disable @everyone and @here mentions by default
            allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
            // Disable partials for better performance
            partials: [],
            // Enable message cache for better performance
            makeCache: Options.cacheWithLimits({
                ...Options.DefaultMakeCacheSettings,
                MessageManager: {
                    maxSize: 200,
                    keepOverLimit: message => message.author.id === this.user?.id,
                },
                // Disable caching for these to save memory
                GuildEmojiManager: 0,
                GuildInviteManager: 0,
                GuildStickerManager: 0,
                PresenceManager: 0,
                ReactionManager: 0,
                StageInstanceManager: 0,
            })
        });

        // Validate config
        if (!config.token) {
            logger.error('Missing bot token in config.json');
            process.exit(1);
        }

        // Initialize collections
        this.commands = new Collection();
        this.buttons = new Collection();
        this.aliases = new Collection();
        this.cooldowns = new Collection();
        this.activeVoiceSessions = new Map();
        
        // Initialize database
        this.db = new DatabaseManager();
        
        // Initialize scheduler
        this.scheduler = new Scheduler(this);

        // Load config with defaults
        this.config = {
            ...config,
            cooldownHours: config.cooldownHours || 48,
            minServerDays: config.minServerDays || 3,
            prefix: config.prefix || '!',
            owners: config.owners || [],
            debug: process.env.NODE_ENV === 'development',
            version: process.env.npm_package_version || '1.0.0'
        };
        
        // Log initialization
        logger.info(`Initializing RankUpBot v${this.config.version}`);
    }

    /**
     * Load all event handlers from the events directory
     */
    async loadEvents() {
        try {
            const eventPath = path.join(__dirname, 'src/events');
            const eventFiles = readdirSync(eventPath)
                .filter(file => file.endsWith('.js') && !file.startsWith('_'));
                
            logger.debug(`Loading ${eventFiles.length} event(s)...`);
            
            for (const file of eventFiles) {
                try {
                    const event = require(path.join(eventPath, file));
                    if (!event.name || !event.execute) {
                        logger.warn(`Event ${file} is missing required properties (name, execute)`);
                        continue;
                    }
                    
                    // Bind the event to the client
                    if (event.once) {
                        this.once(event.name, (...args) => event.execute(...args, this));
                    } else {
                        this.on(event.name, (...args) => event.execute(...args, this));
                    }
                    
                    logger.info(`✅ Loaded event: ${event.name} (${file})`);
                } catch (error) {
                    logger.error(`Error loading event ${file}:`, error);
                }
            }
            
            logger.info(`Successfully loaded ${eventFiles.length} event(s)`);
        } catch (error) {
            logger.error('Failed to load events:', error);
            throw error;
        }
    }

    /**
     * Load all commands from the commands directory
     */
    async loadCommands() {
        try {
            const basePath = path.join(__dirname, 'src/commands');
            const commandFolders = readdirSync(basePath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
                
            logger.debug(`Found ${commandFolders.length} command category(ies)`);
            
            for (const folder of commandFolders) {
                const commandPath = path.join(basePath, folder);
                const commandFiles = readdirSync(commandPath)
                    .filter(file => file.endsWith('.js') && !file.startsWith('_'));
                
                logger.debug(`Loading ${commandFiles.length} command(s) from ${folder}...`);
                
                for (const file of commandFiles) {
                    try {
                        const command = require(path.join(commandPath, file));
                        
                        // Validate command (new structure with data and execute)
                        if (!command.data || !command.execute) {
                            logger.warn(`Command ${file} is missing required properties (data, execute)`);
                            continue;
                        }
                        
                        // Add command to collection using the name from data
                        const commandName = command.data.name;
                        this.commands.set(commandName, command);
                        
                        // Register aliases if they exist
                        if (command.aliases && Array.isArray(command.aliases)) {
                            for (const alias of command.aliases) {
                                this.aliases.set(alias, commandName);
                            }
                        }
                        
                        logger.debug(`Loaded command: ${commandName} (${file})`);
                    } catch (error) {
                        logger.error(`Error loading command ${file}:`, error);
                    }
                }
            }
            
            logger.info(`Successfully loaded ${this.commands.size} command(s) with ${this.aliases.size} alias(es)`);
        } catch (error) {
            logger.error('Failed to load commands:', error);
            throw error;
        }
    }
}

/**
 * Main application entry point
 */
async function main() {
    try {
        // Initialize client
        const client = new RankUpClient();
        
        // Log unhandled promise rejections
        process.on('unhandledRejection', (error) => {
            logger.error('Unhandled Promise Rejection:', error);
        });
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
        });
        
        // Wait for database to be ready
        logger.info('Waiting for database to initialize...');
        await new Promise((resolve) => {
            const checkDB = () => {
                if (client.db && client.db.db) {
                    logger.info('Database connection verified');
                    resolve();
                } else {
                    setTimeout(checkDB, 100);
                }
            };
            checkDB();
        });
        
        // Load events and commands
        logger.info('Loading events and commands...');
        await Promise.all([
            client.loadEvents(),
            client.loadCommands()
        ]);
        
        // Login to Discord
        logger.info('Logging in to Discord...');
        await client.login(config.token);
        
        // Start scheduled tasks
        client.scheduler.scheduleBiWeeklyReset();
        logger.info('Scheduled tasks initialized');
        
        // Handle graceful shutdown
        const handleShutdown = async (signal) => {
            logger.warn(`Received ${signal}, shutting down...`);
            
            try {
                // Clean up resources
                if (client.activeVoiceSessions) {
                    client.activeVoiceSessions.clear();
                }
                
                // Close database connection
                if (client.db && typeof client.db.close === 'function') {
                    await client.db.close();
                }
                
                // Destroy the client
                if (client && !client.destroyed) {
                    client.destroy();
                }
                
                logger.info('Bot has been shut down gracefully');
                process.exit(0);
            } catch (error) {
                logger.error('Error during shutdown:', error);
                process.exit(1);
            }
        };
        
        // Handle different shutdown signals
        process.on('SIGINT', () => handleShutdown('SIGINT'));
        process.on('SIGTERM', () => handleShutdown('SIGTERM'));
        
        logger.info('Bot is now running. Press Ctrl+C to exit.');
        
    } catch (error) {
        logger.error('Fatal error:', error);
        process.exit(1);
    }
}

// Start the application
if (require.main === module) {
    main();
}

// Export for testing purposes
module.exports = { RankUpClient };
