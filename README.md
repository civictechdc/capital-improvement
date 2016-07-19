# Capital Improvement Tracker

Every year, the [DC Office of the Chief Financial Officer](http://cfo.dc.gov/) (OCFO) releases a plan for the next six years of investment in capital improvement projects like buildings and roads. Because this information has only ever been published in a non-open file format, it is difficult for DC residents to access this information and understand how these plans have changed over time.

This [Code for DC](http://codefordc.org/) project scrapes (extracts) data from the OCFO capital improvement plans to make them searchable and comparable. Search for a project to find all of its details and to see how its cost and timeline have changed over time.

## Setup

1. Install [NPM](https://www.npmjs.com).
2. Install [Gulp](http://gulpjs.com) and [Bower](https://bower.io) with the command `npm install -g gulp bower`.
3. Navigate to the local project directory using [cd](http://en.wikipedia.org/wiki/CHDIR).
4. Run the command `npm install`.
5. Run the command `bower install`.
6. Run `gulp serve` and open [localhost:9000](localhost:9000) in your browser.

## Deploy

The website is provided via [GitHub Pages](https://pages.github.com/). There is a gulp task to deploy changes, provided you have push permissions to this repository: `gulp deploy`.

## Contribute

Check out the [issues](https://github.com/codefordc/capital-improvement/issues) tab for potential issues that you could help us solve. All contributions to this project will be released under the [CC0 public domain dedication](https://github.com/codefordc/capital-improvement/blob/master/LICENSE.txt).

Visit [Code for DC](http://codefordc.org/) to learn more about us and how to get involved.
