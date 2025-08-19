import { DataService } from './data-service';

export class BackgroundUpdater {
    private dataService: DataService;
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;
    private readonly MIN_INTERVAL = 15 * 60 * 1000; // 15 minutes
    private readonly MAX_INTERVAL = 20 * 60 * 1000; // 20 minutes

    constructor(dataService: DataService) {
        this.dataService = dataService;
    }

    start(): void {
        if (this.isRunning) {
            console.log('Background updater is already running');
            return;
        }

        this.isRunning = true;
        console.log('Starting background driver data updater...');
        this.scheduleNextUpdate();
    }

    stop(): void {
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('Stopped background driver data updater');
    }

    private scheduleNextUpdate(): void {
        if (!this.isRunning) return;

        // Generate random interval between 15-20 minutes
        const randomInterval = Math.random() * (this.MAX_INTERVAL - this.MIN_INTERVAL) + this.MIN_INTERVAL;
        const minutesUntilNext = Math.round(randomInterval / 60000);

        console.log(`Next driver update scheduled in ${minutesUntilNext} minutes`);

        this.intervalId = setTimeout(async () => {
            await this.updateOldestDriver();
            this.scheduleNextUpdate(); // Schedule the next update
        }, randomInterval);
    }

    private async updateOldestDriver(): Promise<void> {
        try {
            // Get the driver that hasn't been updated the longest
            const oldestDriver = await this.dataService.getOldestDriver();
            
            if (!oldestDriver) {
                console.log('No drivers found to update');
                return;
            }

            const minutesSinceUpdate = Math.round(
                (Date.now() - new Date(oldestDriver.recorded_at).getTime()) / (1000 * 60)
            );

            console.log(`Background updating driver ${oldestDriver.display_name} (ID: ${oldestDriver.customer_id}) - last updated ${minutesSinceUpdate} minutes ago`);

            // Force refresh the driver data
            await this.dataService.loadMemberData(oldestDriver.customer_id, true);

        } catch (error) {
            console.error('Error in background driver update:', error);
        }
    }

    async forceUpdateAll(): Promise<void> {
        console.log('Force updating all drivers...');
        const allDrivers = await this.dataService.getAllStoredDrivers();
        
        for (const driver of allDrivers) {
            try {
                console.log(`Updating ${driver.display_name}...`);
                await this.dataService.loadMemberData(driver.customer_id, true);
                
                // Add a small delay between updates to be respectful
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`Error updating ${driver.display_name}:`, error);
            }
        }
        
        console.log('Finished force updating all drivers');
    }

    isActive(): boolean {
        return this.isRunning;
    }

    getNextUpdateEstimate(): string {
        if (!this.isRunning || !this.intervalId) {
            return 'Not scheduled';
        }
        
        // This is an estimate since we don't track exact timing
        return 'Within 15-20 minutes';
    }
}