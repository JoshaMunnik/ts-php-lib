/**
 * {@link UFPhp} contains support methods related to PHP.
 */
export declare class UFPhp {
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
    static parsePhpConfig(aFilename: string): Promise<any>;
}
