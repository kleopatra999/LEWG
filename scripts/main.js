// Copyright 2015 Google Inc. All Rights Reserved.
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//     http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

let argv = require('yargs')
    .alias('n', 'dryrun')
    .boolean('dryrun')
    .argv;

require('array.prototype.includes');
let handlebars = require('handlebars');
let fs = require('fs');
let isocppIssues = require('./isocppIssues');
let assert = require('assert');
let isocppWiki = require('./isocppWiki')('Wg21jacksonville');

function readHandlebars(filename) {
  return handlebars.compile(fs.readFileSync(filename, {encoding: 'utf8'}));
};

let mainPageTemplate = readHandlebars('mainPage.hbs');
let issuePageTemplate = readHandlebars('issuePage.hbs');

function findLastMatching(regex, comments) {
  assert(regex.global);
  for (let i = comments.length - 1; i >= 0; --i) {
    let comment = comments[i];
    regex.lastIndex = 0;
    let match;
    let matches = [];
    while ((match = regex.exec(comment.text)) !== null) {
      matches.push(match[0]);
    }
    if (matches.length > 0) {
      return matches[matches.length - 1];
    }
  }
  return undefined;
};

function findLastPaper(comments) {
  return findLastMatching(/https?:\/\/www.open-std.org\/jtc1\/sc22\/wg21\/docs\/papers\/\d+\/(?:n\d+|p\d+r\d+)\.\w+|https:\/\/isocpp.org\/files\/papers\/(?:n\d+|p\d+r\d+)\.\w+/ig,
                          comments);
};
function findLatestDiscussion(comments) {
  return findLastMatching(/https?:\/\/wiki.edg.com\/twiki\/bin\/view\/[-\w]+\/[-\w#]+/ig,
                          comments);
};

function computePageName(issue) {
  let paperNumber = /papers\/\d+\/(p\d+r\d+)\.\w+$/.exec(issue.latestPaper);
  if (paperNumber === null) {
    return "LEWG" + issue.id;
  }
  paperNumber = paperNumber[1].toUpperCase();
  paperNumber = paperNumber.replace(/^(P\d+)R\d+$/, "$1");
  return paperNumber;
}

function elaborateIssue(issue) {
  let commentsP = isocppIssues.getComments(issue.id);
  let ccNamesP = isocppIssues.getUserRealNames(issue.cc.filter(addr => {
    // Don't mention the LEWG chair as someone to invite.
    return !addr.startsWith('jyasskin@') &&
      // And don't list the presenter separately.
      addr != issue.assigned_to;
  }));
  let presenterNameP;
  if (issue.assigned_to === 'c++std-lib-ext@accu.org') {
    presenterNameP = Promise.resolve(undefined);
  } else {
    presenterNameP = isocppIssues.getUserRealNames([issue.assigned_to]);
  }
  return Promise.all([commentsP, ccNamesP, presenterNameP])
    .then(function(arr) {
      issue.comments = arr[0];
      issue.ccNames = arr[1];
      issue.presenterName = arr[2];
      issue.latestPaper = findLastPaper(issue.comments);
      issue.latestDiscussion = findLatestDiscussion(issue.comments);
      issue.pageName = computePageName(issue);
      return issue;
    });
};

function genMainPage(issues) {
  return mainPageTemplate({
    issues: issues
  });
};

function genIssuePage(issue) {
  return isocppWiki.writePage({
    name: issue.pageName,
    parent: 'LibraryEvolutionWorkingGroup',
    content: issuePageTemplate({issue: issue}),
    dryrun: argv.dryrun,
  });
};

isocppWiki.login().then(function() {
  return isocppIssues.lewgPlate();
}).then(function(issues) {
  return Promise.all(issues.map(elaborateIssue));
}).then(function(issues) {
  let collator = new Intl.Collator('en');
  issues.sort((a,b) => collator.compare(a.pageName, b.pageName));
  console.log(genMainPage(issues));
  var writes = [];
  for (let issue of issues) {
    writes.push(genIssuePage(issue).catch(function(err) {
      console.error('Failed to write issue ' + issue.id + ': ' + (err.stack || err));
    }));
  }
  return Promise.all(writes);
}).then(writes => {
  if (argv.dryrun) {
    for (let write of writes) {
      console.log(write);
    }
  }
}).catch(function(err) { console.error(err.stack || err); });
