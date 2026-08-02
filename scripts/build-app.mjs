import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
const platform = process.argv.includes('--mac') ? 'macos' : 'windows';
const unsigned = process.argv.includes('--unsigned');
const environment = { ...process.env };
const environmentPath = resolve(projectRoot, 'electron-builder.env');

const stripWrappingQuotes = value =>
{
    const trimmed = value.trim();

    if((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    {
        return trimmed.slice(1, -1);
    }

    return trimmed;
};

if(existsSync(environmentPath))
{
    for(const line of readFileSync(environmentPath, 'utf8').split(/\r?\n/))
    {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);

        if(!match || line.trimStart().startsWith('#') || process.env[match[1]] !== undefined) continue;
        environment[match[1]] = stripWrappingQuotes(match[2]);
    }
}

let updateUrl;

try
{
    updateUrl = new URL(environment.CLOVE_UPDATE_URL);
}
catch
{
    throw new Error('Copy electron-builder.env.example to electron-builder.env and set CLOVE_UPDATE_URL before packaging Clove.');
}

if(updateUrl.protocol !== 'https:') throw new Error('CLOVE_UPDATE_URL must use HTTPS.');
if(/example|replace|your[-_.]?bucket/i.test(updateUrl.hostname)) throw new Error('CLOVE_UPDATE_URL still contains a placeholder hostname.');
environment.CLOVE_UPDATE_URL = updateUrl.toString().replace(/\/$/, '');

if(platform === 'macos' && process.platform !== 'darwin')
{
    throw new Error('macOS packages must be built on macOS.');
}

if(unsigned && platform !== 'macos') throw new Error('--unsigned is supported only for macOS packages.');

if(platform === 'macos' && !unsigned)
{
    const hasCertificate = Boolean(environment.CSC_LINK || environment.CSC_NAME || environment.CSC_KEYCHAIN);
    const hasAppleIdAuthentication = Boolean(environment.APPLE_ID && environment.APPLE_APP_SPECIFIC_PASSWORD && environment.APPLE_TEAM_ID);
    const hasApiKeyAuthentication = Boolean(environment.APPLE_API_KEY && environment.APPLE_API_KEY_ID && environment.APPLE_API_ISSUER);
    const hasKeychainAuthentication = Boolean(environment.APPLE_KEYCHAIN && environment.APPLE_KEYCHAIN_PROFILE);

    if(!hasCertificate) throw new Error('A signed macOS build requires a Developer ID Application certificate.');
    if(!hasAppleIdAuthentication && !hasApiKeyAuthentication && !hasKeychainAuthentication)
    {
        throw new Error('A signed macOS build requires Apple notarization credentials.');
    }
}

const runYarn = args =>
{
    const result = spawnSync('yarn', args, {
        cwd: projectRoot,
        env: environment,
        stdio: 'inherit'
    });

    if(result.error) throw result.error;
    if(result.status !== 0) throw new Error(`yarn ${ args.join(' ') } failed with exit code ${ result.status ?? 'unknown' }.`);
};

runYarn([ 'typecheck' ]);
runYarn([ 'build:renderer' ]);
writeFileSync(resolve(projectRoot, 'dist', 'content-config.json'), `${ JSON.stringify({
    schemaVersion: 1,
    manifestUrl: `${ environment.CLOVE_UPDATE_URL }/content/latest.json`
}, null, 2) }\n`, 'utf8');

const builderArguments = platform === 'macos'
    ? [ 'electron-builder', '--mac', 'dmg', 'zip', '--universal', '--publish', 'never' ]
    : [ 'electron-builder', '--win', 'nsis', '--publish', 'never' ];

if(platform === 'macos' && unsigned)
{
    builderArguments.push(
        '--config.mac.identity=null',
        '--config.mac.hardenedRuntime=false',
        '--config.mac.notarize=false',
        '--config.mac.forceCodeSigning=false'
    );
}

console.log(`Building Clove ${ packageJson.version } for ${ platform === 'macos' ? 'macOS' : 'Windows' }.`);
runYarn(builderArguments);
