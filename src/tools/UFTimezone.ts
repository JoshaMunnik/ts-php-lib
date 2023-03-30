// region imports

import {execFile} from "child_process";
import {promisify} from "util";
import {UFLog} from "@ultraforce/ts-nodejs-lib/dist/UFLog";
import {UFSystem} from "@ultraforce/ts-general-lib/dist/tools/UFSystem";
import {UFText} from "@ultraforce/ts-general-lib/dist/tools/UFText";

// endregion

// region local constants

/**
 * Prefix for logo
 */
const LOG_PREFIX = 'TIMEZONE';

/**
 * execFile as Promise
 */
const execFileAsync = promisify(execFile);

/**
 * Cache life is 1 hour (in milliseconds)
 */
const CACHE_LIFE = 60 * 60 * 1000;

// endregion

// region local types

/**
 * Offset with time it was stored.
 */
class Offset {
  /**
   * Offset to UTC
   */
  offset: number;

  /**
   * system time the value was stored
   */
  time: number;

  constructor() {
    this.offset = 0;
    this.time = -CACHE_LIFE;
  }
}

// endregion

// region class

/**
 * {@link UFTimezone} is a utility class to handle php timezones.
 */
export class UFTimezone {
  // region private variables

  /**
   * Contains cached offset values
   *
   * @private
   */
  private m_cache: Map<string, Offset> = new Map();

  /**
   * Path and filename to php interpreter.
   *
   * @private
   */
  private readonly m_php: string;

  /**
   *
   * @private
   */
  private readonly m_log: UFLog;

  // endregion

  // region constructor

  /**
   * Constructs an intance of {@link UFTimezone}.
   *
   * @param {string} aPhp
   *   Path and filename of php cli interpreter.
   * @param {UFLog} aLog
   *   Log to use.
   */
  constructor(aPhp: string, aLog: UFLog) {
    this.m_php = aPhp;
    this.m_log = aLog;
  }

  // endregion

  // region public methods

  /**
   * Gets the difference to UTC in seconds. The method uses caching and updates the offset after 1 hour.
   *
   * @param {string} aPhpTimezone
   *   A timezone using supported names in PHP
   *
   * @return {number} difference to UTC in seconds.
   */
  async getOffset(aPhpTimezone: string): Promise<number> {
    // get current system time
    const time = UFSystem.time();
    // get offset from cache (if any)
    const offset: Offset = this.m_cache.has(aPhpTimezone)
      ? this.m_cache.get(aPhpTimezone) as Offset
      : new Offset();
    // return cached offset if offset has not expired
    if (offset.time + CACHE_LIFE > time) {
      return offset.offset;
    }
    // get offset from php
    const args = 'echo (new DateTimeZone(\'' + aPhpTimezone + '\'))->getOffset(new DateTime(\'now\', new DateTimeZone(\'UTC\')));';
    try {
      const {stdout, stderr} = await execFileAsync(this.m_php, ['-n', '-r', args]);
      if (stderr) {
        this.m_log.error(LOG_PREFIX, null, 'getOffset', stderr, aPhpTimezone);
      } else {
        offset.offset = parseInt(stdout);
        offset.time = time;
        this.m_log.debug(LOG_PREFIX, 'getOffset', aPhpTimezone, offset);
        this.m_cache.set(aPhpTimezone, offset);
        return offset.offset;
      }
    } catch (error: any) {
      this.m_log.error(LOG_PREFIX, error, 'getOffset', aPhpTimezone);
    }
    // on failure use generated values
    return UFTimezone.s_summerTimezones.get(aPhpTimezone) || 0;
  }

  /**
   * Checks if the zone uses 24 hr formatting.
   *
   * @param {string} aPhpTimezone
   *   A timezone using supported names in PHP
   *
   * @return {boolean true if time zone uses 24 hr formatting
   */
  is24(aPhpTimezone: string): boolean {
    return (aPhpTimezone.indexOf('America') < 0) && (aPhpTimezone.indexOf('London') < 0);
  }

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
  async getLocalFromServerDate(aServerDate: Date, aPhpTimezone: string): Promise<Date> {
    // add difference from timezone (in minutes) of aDate to get utc, then add difference (in seconds) to aPhpTimezone
    return new Date(
      aServerDate.getTime() + 60000 * aServerDate.getTimezoneOffset() + 1000 * await this.getOffset(aPhpTimezone)
    );
  }

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
  async getServerFromLocalDate(aLocalDate: Date, aPhpTimezone: string): Promise<Date> {
    // subtract difference (in seconds) from aPhpTimezone to get utc, then subtract difference (in minutes) for servers
    // timezone
    return new Date(
      aLocalDate.getTime() - 1000 * await this.getOffset(aPhpTimezone) - 60000 * aLocalDate.getTimezoneOffset()
    );
  }

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
  async getUtcFromLocalDate(aLocalDate: Date, aPhpTimezone: string): Promise<Date> {
    // subtract difference (in seconds) from aPhpTimezone to get utc
    return new Date(aLocalDate.getTime() - 1000 * await this.getOffset(aPhpTimezone));
  }

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
  async getLocalTime(
    aServerDate: Date, aPhpTimezone: string, anIncludeSeconds: boolean = false
  ): Promise<string> {
    const localDate = await this.getLocalFromServerDate(aServerDate, aPhpTimezone);
    const is24 = this.is24(aPhpTimezone);
    // get 24 hour value or 12 hour (use 12 when hour is 0)
    const hours = is24 ? localDate.getHours() : (localDate.getHours() % 12) || 12;
    const minutes = ':' + UFText.twoDigits(localDate.getMinutes());
    const seconds = anIncludeSeconds ? ':' + UFText.twoDigits(localDate.getSeconds()) : '';
    const postfix = is24 ? '' : (localDate.getHours() < 12 ? ' am' : ' pm');
    return '' + hours + minutes + seconds + postfix;
  }

  // endregion

  // region private constants

  /**
   * Maps php timezone to offset. The values were generated using utils/timezones.php
   *
   * @private
   */
  private static s_winterTimezones: Map<string, number> = new Map([
    ['Africa/Abidjan', 0],
    ['Africa/Accra', 0],
    ['Africa/Addis_Ababa', 10800],
    ['Africa/Algiers', 3600],
    ['Africa/Asmara', 10800],
    ['Africa/Bamako', 0],
    ['Africa/Bangui', 3600],
    ['Africa/Banjul', 0],
    ['Africa/Bissau', 0],
    ['Africa/Blantyre', 7200],
    ['Africa/Brazzaville', 3600],
    ['Africa/Bujumbura', 7200],
    ['Africa/Cairo', 7200],
    ['Africa/Casablanca', 3600],
    ['Africa/Ceuta', 3600],
    ['Africa/Conakry', 0],
    ['Africa/Dakar', 0],
    ['Africa/Dar_es_Salaam', 10800],
    ['Africa/Djibouti', 10800],
    ['Africa/Douala', 3600],
    ['Africa/El_Aaiun', 3600],
    ['Africa/Freetown', 0],
    ['Africa/Gaborone', 7200],
    ['Africa/Harare', 7200],
    ['Africa/Johannesburg', 7200],
    ['Africa/Juba', 10800],
    ['Africa/Kampala', 10800],
    ['Africa/Khartoum', 7200],
    ['Africa/Kigali', 7200],
    ['Africa/Kinshasa', 3600],
    ['Africa/Lagos', 3600],
    ['Africa/Libreville', 3600],
    ['Africa/Lome', 0],
    ['Africa/Luanda', 3600],
    ['Africa/Lubumbashi', 7200],
    ['Africa/Lusaka', 7200],
    ['Africa/Malabo', 3600],
    ['Africa/Maputo', 7200],
    ['Africa/Maseru', 7200],
    ['Africa/Mbabane', 7200],
    ['Africa/Mogadishu', 10800],
    ['Africa/Monrovia', 0],
    ['Africa/Nairobi', 10800],
    ['Africa/Ndjamena', 3600],
    ['Africa/Niamey', 3600],
    ['Africa/Nouakchott', 0],
    ['Africa/Ouagadougou', 0],
    ['Africa/Porto-Novo', 3600],
    ['Africa/Sao_Tome', 0],
    ['Africa/Tripoli', 7200],
    ['Africa/Tunis', 3600],
    ['Africa/Windhoek', 7200],
    ['America/Adak', -32400],
    ['America/Anchorage', -28800],
    ['America/Anguilla', -14400],
    ['America/Antigua', -14400],
    ['America/Araguaina', -10800],
    ['America/Argentina/Buenos_Aires', -10800],
    ['America/Argentina/Catamarca', -10800],
    ['America/Argentina/Cordoba', -10800],
    ['America/Argentina/Jujuy', -10800],
    ['America/Argentina/La_Rioja', -10800],
    ['America/Argentina/Mendoza', -10800],
    ['America/Argentina/Rio_Gallegos', -10800],
    ['America/Argentina/Salta', -10800],
    ['America/Argentina/San_Juan', -10800],
    ['America/Argentina/San_Luis', -10800],
    ['America/Argentina/Tucuman', -10800],
    ['America/Argentina/Ushuaia', -10800],
    ['America/Aruba', -14400],
    ['America/Asuncion', -10800],
    ['America/Atikokan', -18000],
    ['America/Bahia', -10800],
    ['America/Bahia_Banderas', -21600],
    ['America/Barbados', -14400],
    ['America/Belem', -10800],
    ['America/Belize', -21600],
    ['America/Blanc-Sablon', -14400],
    ['America/Boa_Vista', -14400],
    ['America/Bogota', -18000],
    ['America/Boise', -21600],
    ['America/Cambridge_Bay', -21600],
    ['America/Campo_Grande', -14400],
    ['America/Cancun', -18000],
    ['America/Caracas', -14400],
    ['America/Cayenne', -10800],
    ['America/Cayman', -18000],
    ['America/Chicago', -18000],
    ['America/Chihuahua', -25200],
    ['America/Costa_Rica', -21600],
    ['America/Creston', -25200],
    ['America/Cuiaba', -14400],
    ['America/Curacao', -14400],
    ['America/Danmarkshavn', 0],
    ['America/Dawson', -25200],
    ['America/Dawson_Creek', -25200],
    ['America/Denver', -21600],
    ['America/Detroit', -14400],
    ['America/Dominica', -14400],
    ['America/Edmonton', -21600],
    ['America/Eirunepe', -18000],
    ['America/El_Salvador', -21600],
    ['America/Fort_Nelson', -25200],
    ['America/Fortaleza', -10800],
    ['America/Glace_Bay', -10800],
    ['America/Goose_Bay', -10800],
    ['America/Grand_Turk', -14400],
    ['America/Grenada', -14400],
    ['America/Guadeloupe', -14400],
    ['America/Guatemala', -21600],
    ['America/Guayaquil', -18000],
    ['America/Guyana', -14400],
    ['America/Halifax', -10800],
    ['America/Havana', -14400],
    ['America/Hermosillo', -25200],
    ['America/Indiana/Indianapolis', -14400],
    ['America/Indiana/Knox', -18000],
    ['America/Indiana/Marengo', -14400],
    ['America/Indiana/Petersburg', -14400],
    ['America/Indiana/Tell_City', -18000],
    ['America/Indiana/Vevay', -14400],
    ['America/Indiana/Vincennes', -14400],
    ['America/Indiana/Winamac', -14400],
    ['America/Inuvik', -21600],
    ['America/Iqaluit', -14400],
    ['America/Jamaica', -18000],
    ['America/Juneau', -28800],
    ['America/Kentucky/Louisville', -14400],
    ['America/Kentucky/Monticello', -14400],
    ['America/Kralendijk', -14400],
    ['America/La_Paz', -14400],
    ['America/Lima', -18000],
    ['America/Los_Angeles', -25200],
    ['America/Lower_Princes', -14400],
    ['America/Maceio', -10800],
    ['America/Managua', -21600],
    ['America/Manaus', -14400],
    ['America/Marigot', -14400],
    ['America/Martinique', -14400],
    ['America/Matamoros', -18000],
    ['America/Mazatlan', -25200],
    ['America/Menominee', -18000],
    ['America/Merida', -21600],
    ['America/Metlakatla', -28800],
    ['America/Mexico_City', -21600],
    ['America/Miquelon', -7200],
    ['America/Moncton', -10800],
    ['America/Monterrey', -21600],
    ['America/Montevideo', -10800],
    ['America/Montserrat', -14400],
    ['America/Nassau', -14400],
    ['America/New_York', -14400],
    ['America/Nipigon', -14400],
    ['America/Nome', -28800],
    ['America/Noronha', -7200],
    ['America/North_Dakota/Beulah', -18000],
    ['America/North_Dakota/Center', -18000],
    ['America/North_Dakota/New_Salem', -18000],
    ['America/Nuuk', -10800],
    ['America/Ojinaga', -21600],
    ['America/Panama', -18000],
    ['America/Pangnirtung', -14400],
    ['America/Paramaribo', -10800],
    ['America/Phoenix', -25200],
    ['America/Port-au-Prince', -14400],
    ['America/Port_of_Spain', -14400],
    ['America/Porto_Velho', -14400],
    ['America/Puerto_Rico', -14400],
    ['America/Punta_Arenas', -10800],
    ['America/Rainy_River', -18000],
    ['America/Rankin_Inlet', -18000],
    ['America/Recife', -10800],
    ['America/Regina', -21600],
    ['America/Resolute', -18000],
    ['America/Rio_Branco', -18000],
    ['America/Santarem', -10800],
    ['America/Santiago', -10800],
    ['America/Santo_Domingo', -14400],
    ['America/Sao_Paulo', -10800],
    ['America/Scoresbysund', -3600],
    ['America/Sitka', -28800],
    ['America/St_Barthelemy', -14400],
    ['America/St_Johns', -9000],
    ['America/St_Kitts', -14400],
    ['America/St_Lucia', -14400],
    ['America/St_Thomas', -14400],
    ['America/St_Vincent', -14400],
    ['America/Swift_Current', -21600],
    ['America/Tegucigalpa', -21600],
    ['America/Thule', -10800],
    ['America/Thunder_Bay', -14400],
    ['America/Tijuana', -25200],
    ['America/Toronto', -14400],
    ['America/Tortola', -14400],
    ['America/Vancouver', -25200],
    ['America/Whitehorse', -25200],
    ['America/Winnipeg', -18000],
    ['America/Yakutat', -28800],
    ['America/Yellowknife', -21600],
    ['Antarctica/Casey', 28800],
    ['Antarctica/Davis', 25200],
    ['Antarctica/DumontDUrville', 36000],
    ['Antarctica/Macquarie', 39600],
    ['Antarctica/Mawson', 18000],
    ['Antarctica/McMurdo', 46800],
    ['Antarctica/Palmer', -10800],
    ['Antarctica/Rothera', -10800],
    ['Antarctica/Syowa', 10800],
    ['Antarctica/Troll', 0],
    ['Antarctica/Vostok', 21600],
    ['Arctic/Longyearbyen', 3600],
    ['Asia/Aden', 10800],
    ['Asia/Almaty', 21600],
    ['Asia/Amman', 7200],
    ['Asia/Anadyr', 43200],
    ['Asia/Aqtau', 18000],
    ['Asia/Aqtobe', 18000],
    ['Asia/Ashgabat', 18000],
    ['Asia/Atyrau', 18000],
    ['Asia/Baghdad', 10800],
    ['Asia/Bahrain', 10800],
    ['Asia/Baku', 14400],
    ['Asia/Bangkok', 25200],
    ['Asia/Barnaul', 25200],
    ['Asia/Beirut', 7200],
    ['Asia/Bishkek', 21600],
    ['Asia/Brunei', 28800],
    ['Asia/Chita', 32400],
    ['Asia/Choibalsan', 28800],
    ['Asia/Colombo', 19800],
    ['Asia/Damascus', 7200],
    ['Asia/Dhaka', 21600],
    ['Asia/Dili', 32400],
    ['Asia/Dubai', 14400],
    ['Asia/Dushanbe', 18000],
    ['Asia/Famagusta', 7200],
    ['Asia/Gaza', 7200],
    ['Asia/Hebron', 7200],
    ['Asia/Ho_Chi_Minh', 25200],
    ['Asia/Hong_Kong', 28800],
    ['Asia/Hovd', 25200],
    ['Asia/Irkutsk', 28800],
    ['Asia/Jakarta', 25200],
    ['Asia/Jayapura', 32400],
    ['Asia/Jerusalem', 7200],
    ['Asia/Kabul', 16200],
    ['Asia/Kamchatka', 43200],
    ['Asia/Karachi', 18000],
    ['Asia/Kathmandu', 20700],
    ['Asia/Khandyga', 32400],
    ['Asia/Kolkata', 19800],
    ['Asia/Krasnoyarsk', 25200],
    ['Asia/Kuala_Lumpur', 28800],
    ['Asia/Kuching', 28800],
    ['Asia/Kuwait', 10800],
    ['Asia/Macau', 28800],
    ['Asia/Magadan', 39600],
    ['Asia/Makassar', 28800],
    ['Asia/Manila', 28800],
    ['Asia/Muscat', 14400],
    ['Asia/Nicosia', 7200],
    ['Asia/Novokuznetsk', 25200],
    ['Asia/Novosibirsk', 25200],
    ['Asia/Omsk', 21600],
    ['Asia/Oral', 18000],
    ['Asia/Phnom_Penh', 25200],
    ['Asia/Pontianak', 25200],
    ['Asia/Pyongyang', 32400],
    ['Asia/Qatar', 10800],
    ['Asia/Qostanay', 21600],
    ['Asia/Qyzylorda', 18000],
    ['Asia/Riyadh', 10800],
    ['Asia/Sakhalin', 39600],
    ['Asia/Samarkand', 18000],
    ['Asia/Seoul', 32400],
    ['Asia/Shanghai', 28800],
    ['Asia/Singapore', 28800],
    ['Asia/Srednekolymsk', 39600],
    ['Asia/Taipei', 28800],
    ['Asia/Tashkent', 18000],
    ['Asia/Tbilisi', 14400],
    ['Asia/Tehran', 12600],
    ['Asia/Thimphu', 21600],
    ['Asia/Tokyo', 32400],
    ['Asia/Tomsk', 25200],
    ['Asia/Ulaanbaatar', 28800],
    ['Asia/Urumqi', 21600],
    ['Asia/Ust-Nera', 36000],
    ['Asia/Vientiane', 25200],
    ['Asia/Vladivostok', 36000],
    ['Asia/Yakutsk', 32400],
    ['Asia/Yangon', 23400],
    ['Asia/Yekaterinburg', 18000],
    ['Asia/Yerevan', 14400],
    ['Atlantic/Azores', -3600],
    ['Atlantic/Bermuda', -10800],
    ['Atlantic/Canary', 0],
    ['Atlantic/Cape_Verde', -3600],
    ['Atlantic/Faroe', 0],
    ['Atlantic/Madeira', 0],
    ['Atlantic/Reykjavik', 0],
    ['Atlantic/South_Georgia', -7200],
    ['Atlantic/St_Helena', 0],
    ['Atlantic/Stanley', -10800],
    ['Australia/Adelaide', 37800],
    ['Australia/Brisbane', 36000],
    ['Australia/Broken_Hill', 37800],
    ['Australia/Currie', 39600],
    ['Australia/Darwin', 34200],
    ['Australia/Eucla', 31500],
    ['Australia/Hobart', 39600],
    ['Australia/Lindeman', 36000],
    ['Australia/Lord_Howe', 39600],
    ['Australia/Melbourne', 39600],
    ['Australia/Perth', 28800],
    ['Australia/Sydney', 39600],
    ['Europe/Amsterdam', 3600],
    ['Europe/Andorra', 3600],
    ['Europe/Astrakhan', 14400],
    ['Europe/Athens', 7200],
    ['Europe/Belgrade', 3600],
    ['Europe/Berlin', 3600],
    ['Europe/Bratislava', 3600],
    ['Europe/Brussels', 3600],
    ['Europe/Bucharest', 7200],
    ['Europe/Budapest', 3600],
    ['Europe/Busingen', 3600],
    ['Europe/Chisinau', 7200],
    ['Europe/Copenhagen', 3600],
    ['Europe/Dublin', 0],
    ['Europe/Gibraltar', 3600],
    ['Europe/Guernsey', 0],
    ['Europe/Helsinki', 7200],
    ['Europe/Isle_of_Man', 0],
    ['Europe/Istanbul', 10800],
    ['Europe/Jersey', 0],
    ['Europe/Kaliningrad', 7200],
    ['Europe/Kiev', 7200],
    ['Europe/Kirov', 10800],
    ['Europe/Lisbon', 0],
    ['Europe/Ljubljana', 3600],
    ['Europe/London', 0],
    ['Europe/Luxembourg', 3600],
    ['Europe/Madrid', 3600],
    ['Europe/Malta', 3600],
    ['Europe/Mariehamn', 7200],
    ['Europe/Minsk', 10800],
    ['Europe/Monaco', 3600],
    ['Europe/Moscow', 10800],
    ['Europe/Oslo', 3600],
    ['Europe/Paris', 3600],
    ['Europe/Podgorica', 3600],
    ['Europe/Prague', 3600],
    ['Europe/Riga', 7200],
    ['Europe/Rome', 3600],
    ['Europe/Samara', 14400],
    ['Europe/San_Marino', 3600],
    ['Europe/Sarajevo', 3600],
    ['Europe/Saratov', 14400],
    ['Europe/Simferopol', 10800],
    ['Europe/Skopje', 3600],
    ['Europe/Sofia', 7200],
    ['Europe/Stockholm', 3600],
    ['Europe/Tallinn', 7200],
    ['Europe/Tirane', 3600],
    ['Europe/Ulyanovsk', 14400],
    ['Europe/Uzhgorod', 7200],
    ['Europe/Vaduz', 3600],
    ['Europe/Vatican', 3600],
    ['Europe/Vienna', 3600],
    ['Europe/Vilnius', 7200],
    ['Europe/Volgograd', 14400],
    ['Europe/Warsaw', 3600],
    ['Europe/Zagreb', 3600],
    ['Europe/Zaporozhye', 7200],
    ['Europe/Zurich', 3600],
    ['Indian/Antananarivo', 10800],
    ['Indian/Chagos', 21600],
    ['Indian/Christmas', 25200],
    ['Indian/Cocos', 23400],
    ['Indian/Comoro', 10800],
    ['Indian/Kerguelen', 18000],
    ['Indian/Mahe', 14400],
    ['Indian/Maldives', 18000],
    ['Indian/Mauritius', 14400],
    ['Indian/Mayotte', 10800],
    ['Indian/Reunion', 14400],
    ['Pacific/Apia', 50400],
    ['Pacific/Auckland', 46800],
    ['Pacific/Bougainville', 39600],
    ['Pacific/Chatham', 49500],
    ['Pacific/Chuuk', 36000],
    ['Pacific/Easter', -18000],
    ['Pacific/Efate', 39600],
    ['Pacific/Enderbury', 46800],
    ['Pacific/Fakaofo', 46800],
    ['Pacific/Fiji', 43200],
    ['Pacific/Funafuti', 43200],
    ['Pacific/Galapagos', -21600],
    ['Pacific/Gambier', -32400],
    ['Pacific/Guadalcanal', 39600],
    ['Pacific/Guam', 36000],
    ['Pacific/Honolulu', -36000],
    ['Pacific/Kiritimati', 50400],
    ['Pacific/Kosrae', 39600],
    ['Pacific/Kwajalein', 43200],
    ['Pacific/Majuro', 43200],
    ['Pacific/Marquesas', -34200],
    ['Pacific/Midway', -39600],
    ['Pacific/Nauru', 43200],
    ['Pacific/Niue', -39600],
    ['Pacific/Norfolk', 43200],
    ['Pacific/Noumea', 39600],
    ['Pacific/Pago_Pago', -39600],
    ['Pacific/Palau', 32400],
    ['Pacific/Pitcairn', -28800],
    ['Pacific/Pohnpei', 39600],
    ['Pacific/Port_Moresby', 36000],
    ['Pacific/Rarotonga', -36000],
    ['Pacific/Saipan', 36000],
    ['Pacific/Tahiti', -36000],
    ['Pacific/Tarawa', 43200],
    ['Pacific/Tongatapu', 46800],
    ['Pacific/Wake', 43200],
    ['Pacific/Wallis', 43200],
    ['UTC', 0]
  ]);

  /**
   * Maps php timezone to offset. The values were generated using utils/timezones.php
   *
   * @private
   */
  private static s_summerTimezones: Map<string, number> = new Map([
    ['Africa/Abidjan', 0],
    ['Africa/Accra', 0],
    ['Africa/Addis_Ababa', 10800],
    ['Africa/Algiers', 3600],
    ['Africa/Asmara', 10800],
    ['Africa/Bamako', 0],
    ['Africa/Bangui', 3600],
    ['Africa/Banjul', 0],
    ['Africa/Bissau', 0],
    ['Africa/Blantyre', 7200],
    ['Africa/Brazzaville', 3600],
    ['Africa/Bujumbura', 7200],
    ['Africa/Cairo', 7200],
    ['Africa/Casablanca', 3600],
    ['Africa/Ceuta', 7200],
    ['Africa/Conakry', 0],
    ['Africa/Dakar', 0],
    ['Africa/Dar_es_Salaam', 10800],
    ['Africa/Djibouti', 10800],
    ['Africa/Douala', 3600],
    ['Africa/El_Aaiun', 3600],
    ['Africa/Freetown', 0],
    ['Africa/Gaborone', 7200],
    ['Africa/Harare', 7200],
    ['Africa/Johannesburg', 7200],
    ['Africa/Juba', 10800],
    ['Africa/Kampala', 10800],
    ['Africa/Khartoum', 7200],
    ['Africa/Kigali', 7200],
    ['Africa/Kinshasa', 3600],
    ['Africa/Lagos', 3600],
    ['Africa/Libreville', 3600],
    ['Africa/Lome', 0],
    ['Africa/Luanda', 3600],
    ['Africa/Lubumbashi', 7200],
    ['Africa/Lusaka', 7200],
    ['Africa/Malabo', 3600],
    ['Africa/Maputo', 7200],
    ['Africa/Maseru', 7200],
    ['Africa/Mbabane', 7200],
    ['Africa/Mogadishu', 10800],
    ['Africa/Monrovia', 0],
    ['Africa/Nairobi', 10800],
    ['Africa/Ndjamena', 3600],
    ['Africa/Niamey', 3600],
    ['Africa/Nouakchott', 0],
    ['Africa/Ouagadougou', 0],
    ['Africa/Porto-Novo', 3600],
    ['Africa/Sao_Tome', 0],
    ['Africa/Tripoli', 7200],
    ['Africa/Tunis', 3600],
    ['Africa/Windhoek', 7200],
    ['America/Adak', -32400],
    ['America/Anchorage', -28800],
    ['America/Anguilla', -14400],
    ['America/Antigua', -14400],
    ['America/Araguaina', -10800],
    ['America/Argentina/Buenos_Aires', -10800],
    ['America/Argentina/Catamarca', -10800],
    ['America/Argentina/Cordoba', -10800],
    ['America/Argentina/Jujuy', -10800],
    ['America/Argentina/La_Rioja', -10800],
    ['America/Argentina/Mendoza', -10800],
    ['America/Argentina/Rio_Gallegos', -10800],
    ['America/Argentina/Salta', -10800],
    ['America/Argentina/San_Juan', -10800],
    ['America/Argentina/San_Luis', -10800],
    ['America/Argentina/Tucuman', -10800],
    ['America/Argentina/Ushuaia', -10800],
    ['America/Aruba', -14400],
    ['America/Asuncion', -14400],
    ['America/Atikokan', -18000],
    ['America/Bahia', -10800],
    ['America/Bahia_Banderas', -21600],
    ['America/Barbados', -14400],
    ['America/Belem', -10800],
    ['America/Belize', -21600],
    ['America/Blanc-Sablon', -14400],
    ['America/Boa_Vista', -14400],
    ['America/Bogota', -18000],
    ['America/Boise', -21600],
    ['America/Cambridge_Bay', -21600],
    ['America/Campo_Grande', -14400],
    ['America/Cancun', -18000],
    ['America/Caracas', -14400],
    ['America/Cayenne', -10800],
    ['America/Cayman', -18000],
    ['America/Chicago', -18000],
    ['America/Chihuahua', -25200],
    ['America/Costa_Rica', -21600],
    ['America/Creston', -25200],
    ['America/Cuiaba', -14400],
    ['America/Curacao', -14400],
    ['America/Danmarkshavn', 0],
    ['America/Dawson', -25200],
    ['America/Dawson_Creek', -25200],
    ['America/Denver', -21600],
    ['America/Detroit', -14400],
    ['America/Dominica', -14400],
    ['America/Edmonton', -21600],
    ['America/Eirunepe', -18000],
    ['America/El_Salvador', -21600],
    ['America/Fort_Nelson', -25200],
    ['America/Fortaleza', -10800],
    ['America/Glace_Bay', -10800],
    ['America/Godthab', -7200],
    ['America/Goose_Bay', -10800],
    ['America/Grand_Turk', -14400],
    ['America/Grenada', -14400],
    ['America/Guadeloupe', -14400],
    ['America/Guatemala', -21600],
    ['America/Guayaquil', -18000],
    ['America/Guyana', -14400],
    ['America/Halifax', -10800],
    ['America/Havana', -14400],
    ['America/Hermosillo', -25200],
    ['America/Indiana/Indianapolis', -14400],
    ['America/Indiana/Knox', -18000],
    ['America/Indiana/Marengo', -14400],
    ['America/Indiana/Petersburg', -14400],
    ['America/Indiana/Tell_City', -18000],
    ['America/Indiana/Vevay', -14400],
    ['America/Indiana/Vincennes', -14400],
    ['America/Indiana/Winamac', -14400],
    ['America/Inuvik', -21600],
    ['America/Iqaluit', -14400],
    ['America/Jamaica', -18000],
    ['America/Juneau', -28800],
    ['America/Kentucky/Louisville', -14400],
    ['America/Kentucky/Monticello', -14400],
    ['America/Kralendijk', -14400],
    ['America/La_Paz', -14400],
    ['America/Lima', -18000],
    ['America/Los_Angeles', -25200],
    ['America/Lower_Princes', -14400],
    ['America/Maceio', -10800],
    ['America/Managua', -21600],
    ['America/Manaus', -14400],
    ['America/Marigot', -14400],
    ['America/Martinique', -14400],
    ['America/Matamoros', -18000],
    ['America/Mazatlan', -25200],
    ['America/Menominee', -18000],
    ['America/Merida', -21600],
    ['America/Metlakatla', -28800],
    ['America/Mexico_City', -21600],
    ['America/Miquelon', -7200],
    ['America/Moncton', -10800],
    ['America/Monterrey', -21600],
    ['America/Montevideo', -10800],
    ['America/Montserrat', -14400],
    ['America/Nassau', -14400],
    ['America/New_York', -14400],
    ['America/Nipigon', -14400],
    ['America/Nome', -28800],
    ['America/Noronha', -7200],
    ['America/North_Dakota/Beulah', -18000],
    ['America/North_Dakota/Center', -18000],
    ['America/North_Dakota/New_Salem', -18000],
    ['America/Ojinaga', -21600],
    ['America/Panama', -18000],
    ['America/Pangnirtung', -14400],
    ['America/Paramaribo', -10800],
    ['America/Phoenix', -25200],
    ['America/Port-au-Prince', -14400],
    ['America/Port_of_Spain', -14400],
    ['America/Porto_Velho', -14400],
    ['America/Puerto_Rico', -14400],
    ['America/Punta_Arenas', -10800],
    ['America/Rainy_River', -18000],
    ['America/Rankin_Inlet', -18000],
    ['America/Recife', -10800],
    ['America/Regina', -21600],
    ['America/Resolute', -18000],
    ['America/Rio_Branco', -18000],
    ['America/Santarem', -10800],
    ['America/Santiago', -10800],
    ['America/Santo_Domingo', -14400],
    ['America/Sao_Paulo', -10800],
    ['America/Scoresbysund', 0],
    ['America/Sitka', -28800],
    ['America/St_Barthelemy', -14400],
    ['America/St_Johns', -9000],
    ['America/St_Kitts', -14400],
    ['America/St_Lucia', -14400],
    ['America/St_Thomas', -14400],
    ['America/St_Vincent', -14400],
    ['America/Swift_Current', -21600],
    ['America/Tegucigalpa', -21600],
    ['America/Thule', -10800],
    ['America/Thunder_Bay', -14400],
    ['America/Tijuana', -25200],
    ['America/Toronto', -14400],
    ['America/Tortola', -14400],
    ['America/Vancouver', -25200],
    ['America/Whitehorse', -25200],
    ['America/Winnipeg', -18000],
    ['America/Yakutat', -28800],
    ['America/Yellowknife', -21600],
    ['Antarctica/Casey', 28800],
    ['Antarctica/Davis', 25200],
    ['Antarctica/DumontDUrville', 36000],
    ['Antarctica/Macquarie', 39600],
    ['Antarctica/Mawson', 18000],
    ['Antarctica/McMurdo', 46800],
    ['Antarctica/Palmer', -10800],
    ['Antarctica/Rothera', -10800],
    ['Antarctica/Syowa', 10800],
    ['Antarctica/Troll', 7200],
    ['Antarctica/Vostok', 21600],
    ['Arctic/Longyearbyen', 7200],
    ['Asia/Aden', 10800],
    ['Asia/Almaty', 21600],
    ['Asia/Amman', 10800],
    ['Asia/Anadyr', 43200],
    ['Asia/Aqtau', 18000],
    ['Asia/Aqtobe', 18000],
    ['Asia/Ashgabat', 18000],
    ['Asia/Atyrau', 18000],
    ['Asia/Baghdad', 10800],
    ['Asia/Bahrain', 10800],
    ['Asia/Baku', 14400],
    ['Asia/Bangkok', 25200],
    ['Asia/Barnaul', 25200],
    ['Asia/Beirut', 10800],
    ['Asia/Bishkek', 21600],
    ['Asia/Brunei', 28800],
    ['Asia/Chita', 32400],
    ['Asia/Choibalsan', 28800],
    ['Asia/Colombo', 19800],
    ['Asia/Damascus', 10800],
    ['Asia/Dhaka', 21600],
    ['Asia/Dili', 32400],
    ['Asia/Dubai', 14400],
    ['Asia/Dushanbe', 18000],
    ['Asia/Famagusta', 10800],
    ['Asia/Gaza', 10800],
    ['Asia/Hebron', 10800],
    ['Asia/Ho_Chi_Minh', 25200],
    ['Asia/Hong_Kong', 28800],
    ['Asia/Hovd', 25200],
    ['Asia/Irkutsk', 28800],
    ['Asia/Jakarta', 25200],
    ['Asia/Jayapura', 32400],
    ['Asia/Jerusalem', 10800],
    ['Asia/Kabul', 16200],
    ['Asia/Kamchatka', 43200],
    ['Asia/Karachi', 18000],
    ['Asia/Kathmandu', 20700],
    ['Asia/Khandyga', 32400],
    ['Asia/Kolkata', 19800],
    ['Asia/Krasnoyarsk', 25200],
    ['Asia/Kuala_Lumpur', 28800],
    ['Asia/Kuching', 28800],
    ['Asia/Kuwait', 10800],
    ['Asia/Macau', 28800],
    ['Asia/Magadan', 39600],
    ['Asia/Makassar', 28800],
    ['Asia/Manila', 28800],
    ['Asia/Muscat', 14400],
    ['Asia/Nicosia', 10800],
    ['Asia/Novokuznetsk', 25200],
    ['Asia/Novosibirsk', 25200],
    ['Asia/Omsk', 21600],
    ['Asia/Oral', 18000],
    ['Asia/Phnom_Penh', 25200],
    ['Asia/Pontianak', 25200],
    ['Asia/Pyongyang', 32400],
    ['Asia/Qatar', 10800],
    ['Asia/Qostanay', 21600],
    ['Asia/Qyzylorda', 18000],
    ['Asia/Riyadh', 10800],
    ['Asia/Sakhalin', 39600],
    ['Asia/Samarkand', 18000],
    ['Asia/Seoul', 32400],
    ['Asia/Shanghai', 28800],
    ['Asia/Singapore', 28800],
    ['Asia/Srednekolymsk', 39600],
    ['Asia/Taipei', 28800],
    ['Asia/Tashkent', 18000],
    ['Asia/Tbilisi', 14400],
    ['Asia/Tehran', 16200],
    ['Asia/Thimphu', 21600],
    ['Asia/Tokyo', 32400],
    ['Asia/Tomsk', 25200],
    ['Asia/Ulaanbaatar', 28800],
    ['Asia/Urumqi', 21600],
    ['Asia/Ust-Nera', 36000],
    ['Asia/Vientiane', 25200],
    ['Asia/Vladivostok', 36000],
    ['Asia/Yakutsk', 32400],
    ['Asia/Yangon', 23400],
    ['Asia/Yekaterinburg', 18000],
    ['Asia/Yerevan', 14400],
    ['Atlantic/Azores', 0],
    ['Atlantic/Bermuda', -10800],
    ['Atlantic/Canary', 3600],
    ['Atlantic/Cape_Verde', -3600],
    ['Atlantic/Faroe', 3600],
    ['Atlantic/Madeira', 3600],
    ['Atlantic/Reykjavik', 0],
    ['Atlantic/South_Georgia', -7200],
    ['Atlantic/St_Helena', 0],
    ['Atlantic/Stanley', -10800],
    ['Australia/Adelaide', 37800],
    ['Australia/Brisbane', 36000],
    ['Australia/Broken_Hill', 37800],
    ['Australia/Currie', 39600],
    ['Australia/Darwin', 34200],
    ['Australia/Eucla', 31500],
    ['Australia/Hobart', 39600],
    ['Australia/Lindeman', 36000],
    ['Australia/Lord_Howe', 39600],
    ['Australia/Melbourne', 39600],
    ['Australia/Perth', 28800],
    ['Australia/Sydney', 39600],
    ['Europe/Amsterdam', 7200],
    ['Europe/Andorra', 7200],
    ['Europe/Astrakhan', 14400],
    ['Europe/Athens', 10800],
    ['Europe/Belgrade', 7200],
    ['Europe/Berlin', 7200],
    ['Europe/Bratislava', 7200],
    ['Europe/Brussels', 7200],
    ['Europe/Bucharest', 10800],
    ['Europe/Budapest', 7200],
    ['Europe/Busingen', 7200],
    ['Europe/Chisinau', 10800],
    ['Europe/Copenhagen', 7200],
    ['Europe/Dublin', 3600],
    ['Europe/Gibraltar', 7200],
    ['Europe/Guernsey', 3600],
    ['Europe/Helsinki', 10800],
    ['Europe/Isle_of_Man', 3600],
    ['Europe/Istanbul', 10800],
    ['Europe/Jersey', 3600],
    ['Europe/Kaliningrad', 7200],
    ['Europe/Kiev', 10800],
    ['Europe/Kirov', 10800],
    ['Europe/Lisbon', 3600],
    ['Europe/Ljubljana', 7200],
    ['Europe/London', 3600],
    ['Europe/Luxembourg', 7200],
    ['Europe/Madrid', 7200],
    ['Europe/Malta', 7200],
    ['Europe/Mariehamn', 10800],
    ['Europe/Minsk', 10800],
    ['Europe/Monaco', 7200],
    ['Europe/Moscow', 10800],
    ['Europe/Oslo', 7200],
    ['Europe/Paris', 7200],
    ['Europe/Podgorica', 7200],
    ['Europe/Prague', 7200],
    ['Europe/Riga', 10800],
    ['Europe/Rome', 7200],
    ['Europe/Samara', 14400],
    ['Europe/San_Marino', 7200],
    ['Europe/Sarajevo', 7200],
    ['Europe/Saratov', 14400],
    ['Europe/Simferopol', 10800],
    ['Europe/Skopje', 7200],
    ['Europe/Sofia', 10800],
    ['Europe/Stockholm', 7200],
    ['Europe/Tallinn', 10800],
    ['Europe/Tirane', 7200],
    ['Europe/Ulyanovsk', 14400],
    ['Europe/Uzhgorod', 10800],
    ['Europe/Vaduz', 7200],
    ['Europe/Vatican', 7200],
    ['Europe/Vienna', 7200],
    ['Europe/Vilnius', 10800],
    ['Europe/Volgograd', 14400],
    ['Europe/Warsaw', 7200],
    ['Europe/Zagreb', 7200],
    ['Europe/Zaporozhye', 10800],
    ['Europe/Zurich', 7200],
    ['Indian/Antananarivo', 10800],
    ['Indian/Chagos', 21600],
    ['Indian/Christmas', 25200],
    ['Indian/Cocos', 23400],
    ['Indian/Comoro', 10800],
    ['Indian/Kerguelen', 18000],
    ['Indian/Mahe', 14400],
    ['Indian/Maldives', 18000],
    ['Indian/Mauritius', 14400],
    ['Indian/Mayotte', 10800],
    ['Indian/Reunion', 14400],
    ['Pacific/Apia', 50400],
    ['Pacific/Auckland', 46800],
    ['Pacific/Bougainville', 39600],
    ['Pacific/Chatham', 49500],
    ['Pacific/Chuuk', 36000],
    ['Pacific/Easter', -18000],
    ['Pacific/Efate', 39600],
    ['Pacific/Enderbury', 46800],
    ['Pacific/Fakaofo', 46800],
    ['Pacific/Fiji', 43200],
    ['Pacific/Funafuti', 43200],
    ['Pacific/Galapagos', -21600],
    ['Pacific/Gambier', -32400],
    ['Pacific/Guadalcanal', 39600],
    ['Pacific/Guam', 36000],
    ['Pacific/Honolulu', -36000],
    ['Pacific/Kiritimati', 50400],
    ['Pacific/Kosrae', 39600],
    ['Pacific/Kwajalein', 43200],
    ['Pacific/Majuro', 43200],
    ['Pacific/Marquesas', -34200],
    ['Pacific/Midway', -39600],
    ['Pacific/Nauru', 43200],
    ['Pacific/Niue', -39600],
    ['Pacific/Norfolk', 39600],
    ['Pacific/Noumea', 39600],
    ['Pacific/Pago_Pago', -39600],
    ['Pacific/Palau', 32400],
    ['Pacific/Pitcairn', -28800],
    ['Pacific/Pohnpei', 39600],
    ['Pacific/Port_Moresby', 36000],
    ['Pacific/Rarotonga', -36000],
    ['Pacific/Saipan', 36000],
    ['Pacific/Tahiti', -36000],
    ['Pacific/Tarawa', 43200],
    ['Pacific/Tongatapu', 46800],
    ['Pacific/Wake', 43200],
    ['Pacific/Wallis', 43200],
    ['UTC', 0],
  ]);

  // endregion
}

// endregion
