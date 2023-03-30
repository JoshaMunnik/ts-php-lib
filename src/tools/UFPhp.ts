// region imports

import {constants} from 'fs';
import {access, readFile} from 'fs/promises';

// endregion

// region types

/**
 * {@link UFPhp} contains support methods related to PHP.
 */
export class UFPhp {
  // region public methods

  /**
   * Parses a php configuration file. The configuration file should contain a single return statement that returns
   * a php array.
   *
   * The array gets converted to a JSON formatted structure and then parsed.
   *
   * @param {string} aFilename
   *   File to parse (including path on server)
   *
   * @return {object} Parsed configuration.
   */
  static async parsePhpConfig(aFilename: string): Promise<any> {
    try {
      await access(aFilename, constants.R_OK);
      const phpConfig = await readFile(aFilename);
      let config = phpConfig.toString();
      // remove comments
      // see https://blog.ostermiller.org/finding-comments-in-source-code-using-regular-expressions/
      config = config.replace(/\/\*(.|[\r\n])*?\*+\//gi, '');
      config = config.replace(/\/\/.+/gi, '');
      // remove use
      config = config.replace(/use.*;/gi, '');
      // remove other php snippets (use strings, since every item occurs once)
      config = config.replace('<?php', '').replace('return ', '').replace(';', '');
      // add quotes to values that are not starting with a quote or number and are not equal to true/false/null
      config = config.replace(/=>\s+([^0-9"'].*),/gi, x => {
        // get value after => without the ,
        x = x.replace(/=>\s+/, '');
        x = x.replace(/,$/, '');
        // add quotes if value does not match a known literal value
        if ((x != 'true') && (x != 'false') && (x != 'null')) {
          // add single quotes and add \ to any single quote in the value
          x = '\'' + x.replace(/'/g, '\\\'') + '\'';
        }
        return '=> ' + x + ',';
      });
      // replace array defs with object def
      config = config.replace(/\[/gi, '{').replace(/]/gi, '}').replace(/=>/gi, ':');
      // remove any , without a new property following it
      config = config.replace(/,(\s|[\r\n])*?}/gi, '}');
      // json uses "
      config = config.replace(/'/gi, '"');
      // parse as json
      return JSON.parse(config);
    } catch (error) {
      console.error(error);
      return false;
    }
  }
}

// endregion
