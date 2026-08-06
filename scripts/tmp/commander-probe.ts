import { Command, Option } from 'commander';

const program = new Command();

program
  .name('mycli')
  .description('does a thing')
  .version('1.0.0');

program
  .command('build')
  .description('build the project')
  .argument('<entry>', 'entry file')
  .option('-o, --out <dir>', 'output directory', 'dist')
  .option('--minify', 'minify output')
  .addOption(new Option('--target <t>', 'build target').choices(['node', 'browser']))
  .action((entry, options) => {
    console.log(entry, options.out, options.minify, options.target);
  });

program.parse();

