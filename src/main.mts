#!/usr/bin/env node

import { spawn } from 'child_process';
import { Command } from 'commander';
import { promises as fsp } from 'fs';
import inquirer, { type DistinctQuestion } from 'inquirer';
import path from 'path';
import { v4 as uuidv4 } from "uuid";

const __templateDir = path.resolve(import.meta.url.substring('file:///'.length), '../../template');

interface Arguments {
    packageName?: string;
    name?: string;
    description?: string;
    author?: string;
}

const descriptions = {
    name: 'The name displayed to mod users',
    packageName: 'The name used for the npm package (no spaces, lowercase)',
    description: 'A short description of the mod',
    author: 'The author of the mod'
};

async function copyDir(src: string, dest: string) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const ent of entries) {
        const srcPath = path.join(src, ent.name);
        const destPath = path.join(dest, ent.name);
        if (ent.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else if (ent.isSymbolicLink()) {
            const link = await fsp.readlink(srcPath);
            await fsp.symlink(link, destPath);
        } else {
            await fsp.copyFile(srcPath, destPath);
        }
    }
}

async function runNpmInstall(cwd: string) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn('npm install', { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error('npm install failed')));
    });
}

async function runGitInit(cwd: string) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn('git init', { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error('git init failed')));
    });
}

async function askDestName(): Promise<string> {
    const ans = await inquirer.prompt([{ name: 'dest', message: 'Project folder name:', type: 'input' }]);
    const dest = (ans.dest || '').trim();
    if (!dest) {
        console.error('No folder name provided. Exiting.');
        process.exit(1);
    }
    return dest;
}

async function askPackageFields(providedBase: Arguments): Promise<Arguments> {
    const result = Object.assign({}, providedBase);
    const prompts: DistinctQuestion[] = [];

    if (!providedBase.name) {
        prompts.push({ name: 'name', message: descriptions.name + ":", type: 'input' });
    }
    if (!providedBase.description) {
        prompts.push({ name: 'description', message: descriptions.description + ":", type: 'input' });
    }
    if (!providedBase.author) {
        prompts.push({ name: 'author', message: descriptions.author + ":", type: 'input' });
    }
    if (!providedBase.packageName) {
        const defaultPackageName = providedBase.name ? providedBase.name.toLowerCase().replace(/\s+/g, '-') : undefined;
        prompts.push({
            name: 'packageName',
            message: descriptions.packageName + ":",
            type: 'input',
            default: defaultPackageName,
            validate: (input) => {
                if (!input) return 'Package name cannot be empty';
                if (/\s/.test(input)) return 'Package name cannot contain spaces';
                if (input.toLowerCase() !== input) return 'Package name must be lowercase';
                if (!/^(?:(?:@(?:[a-z0-9-*~][a-z0-9-*._~]*)?\/[a-z0-9-._~])|[a-z0-9-~])[a-z0-9-._~]*$/.test(input)) {
                    return 'Invalid npm package name. Refer to https://docs.npmjs.com/creating-a-package-json-file#required-name-and-version-fields for rules.';
                }
                return true;
            },
        });
    }

    if (prompts.length) {
        const answers = await inquirer.prompt(prompts);
        for (const k of Object.keys(answers) as Array<keyof Arguments>) result[k] = answers[k] || result[k];
    }
    return result;
}

async function applyPackageFields(pkgPath: string, raw: string, provided: Arguments) {
    const replaced = raw
        .replace(/<package-name>/g, provided.packageName || '')
        .replace(/<description>/g, provided.description || '')
        .replace(/<author>/g, provided.author || '')
        .replace(/<uuid>/g, uuidv4())
        .replace(/<name>/g, provided.name || '')
    await fsp.writeFile(pkgPath, replaced, 'utf8');
}

async function main() {
    const program = new Command();
    program
        .argument('[dir]', 'destination folder name')
        .option('-n, --name <name>', descriptions.name)
        .option('-p, --package-name <name>', descriptions.packageName)
        .option('-d, --description <description>', descriptions.description)
        .option('-a, --author <author>', descriptions.author)
        .parse(process.argv);

    program.addHelpCommand();

    const opts = program.opts();
    const destName = opts.dir || await askDestName();
    const cwd = process.cwd();
    const templatePath = __templateDir;

    const destPath = path.join(cwd, destName);

    try {
        const stat = await fsp.stat(templatePath);
        if (!stat.isDirectory()) throw new Error('template is not a directory');
    } catch (err) {
        console.error('Could not find template directory at', templatePath);
        process.exit(1);
    }

    try {
        const exists = await fsp.stat(destPath).then(() => true).catch(() => false);
        if (exists) {
            console.error(`Destination ${destPath} already exists. Aborting.`);
            process.exit(1);
        }

        const providedBase: Arguments = {
            name: opts.name,
            description: opts.description || opts.desc,
            author: opts.author,
            packageName: opts.packageName,
        };

        const provided = await askPackageFields(providedBase);

        console.log('Copying template to', destPath, '...');
        await copyDir(templatePath, destPath);

        // After copy, apply the provided package fields to the destination package.json
        const pkgPath = path.join(destPath, 'package.json');
        const pkgExists = await fsp.stat(pkgPath).then(() => true).catch(() => false);
        if (pkgExists) {
            const raw = await fsp.readFile(pkgPath, 'utf8');
            await applyPackageFields(pkgPath, raw, provided);
        }

        console.log('Installing dependencies...');
        await runNpmInstall(destPath);

        console.log('Installing git repository...');
        await runGitInit(destPath).catch(() => console.warn('Git initialization failed'));

        console.log('Done.');
    } catch (err: any) {
        console.error('Error:', err.message || err);
        process.exit(1);
    }
}

main();