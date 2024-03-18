import { IUFLog } from "@ultraforce/ts-nodejs-lib/dist/log/IUFLog.js";
/**
 * {@link UFTimezone} is a utility class to handle php timezones.
 */
export declare class UFTimezone {
    /**
     * Contains cached offset values
     *
     * @private
     */
    private m_cache;
    /**
     * Path and filename to php interpreter.
     *
     * @private
     */
    private readonly m_php;
    /**
     *
     * @private
     */
    private readonly m_log;
    /**
     * Constructs an intance of {@link UFTimezone}.
     *
     * @param {string} aPhp
     *   Path and filename of php cli interpreter.
     * @param {IUFLog} aLog
     *   Log to use.
     */
    constructor(aPhp: string, aLog: IUFLog);
    /**
     * Gets the difference to UTC in seconds. The method uses caching and updates the offset after 1 hour.
     *
     * @param {string} aPhpTimezone
     *   A timezone using supported names in PHP
     *
     * @return {number} difference to UTC in seconds.
     */
    getOffset(aPhpTimezone: string): Promise<number>;
    /**
     * Checks if the zone uses 24 hr formatting.
     *
     * @param {string} aPhpTimezone
     *   A timezone using supported names in PHP
     *
     * @return {boolean true if time zone uses 24 hr formatting
     */
    is24(aPhpTimezone: string): boolean;
    /**
     * Gets the date/time for a specific timezone from a date/time using the timezone of the server.
     *
     * @param {Date} aServerDate
     *   Date using the server timezone
     * @param {string} aPhpTimezone
     *   Timezone to convert to
     *
     * @return {Date} date/time for the timezone
     */
    getLocalFromServerDate(aServerDate: Date, aPhpTimezone: string): Promise<Date>;
    /**
     * Converts a date/time for a certain timezone to the date/time using the timezone of the server.
     *
     * @param {Date} aLocalDate
     *   Date to convert
     * @param {string} aPhpTimezone
     *   Timezone aDate is defined for
     *
     * @return {Date} the date/time using the servers timezone.
     */
    getServerFromLocalDate(aLocalDate: Date, aPhpTimezone: string): Promise<Date>;
    /**
     * Converts a date/time for a certain timezone to the utc date/time.
     *
     * @param {Date} aLocalDate
     *   Date to convert
     * @param {string} aPhpTimezone
     *   Timezone aDate is defined for
     *
     * @return {Date} the date/time using the utc timezone.
     */
    getUtcFromLocalDate(aLocalDate: Date, aPhpTimezone: string): Promise<Date>;
    /**
     * Converts a date/time using the server timezone to a local time representation either using 24 hour or 12 hour
     * format (using pm/am).
     *
     * Reference:
     * https://en.wikipedia.org/wiki/12-hour_clock
     *
     * @param {Date} aServerDate
     *   Date to convert
     * @param {string} aPhpTimezone
     *   Timezone to convert to (this value is also used to determine 12 or 24 hour format)
     * @param {boolean} anIncludeSeconds
     *   When true include seconds in value else only return hour and minutes.
     *
     * @return {string} a formatted time: H:mm [am|pm] or H::mm:ss [am|pm]
     */
    getLocalTime(aServerDate: Date, aPhpTimezone: string, anIncludeSeconds?: boolean): Promise<string>;
    /**
     * Maps php timezone to offset. The values were generated using utils/timezones.php
     *
     * @private
     */
    private static s_winterTimezones;
    /**
     * Maps php timezone to offset. The values were generated using utils/timezones.php
     *
     * @private
     */
    private static s_summerTimezones;
}
