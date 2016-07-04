/* global $ */

const d3 = require('d3');
const _ = require('lodash');
const Fuse = require('fuse.js');

const SUMMARY_PATH = 'data/summary.json';
const DETAIL_PATH_FOR_ID = (id) => `data/projects/${id}.json`;

const TITLE = 'DC Capital Improvement Tracker';
const CURRENT_YEAR = 2017;
const RESULTS_PER_PAGE = 20;
const CHART_LEFT_MARGIN = 135;
const YEAR_WIDTH = 100;
const CUM_FUNDING_HEIGHT = 120;
const CUM_FUNDING_BAR_WIDTH = 45;
const HIST_CHART_INDENT = 38;

const DOLLAR_FORMAT = d3.format('$,');
const SHORT_DOLLAR_FORMAT = d3.format('$.2s');
const PERCENT_FORMAT = d3.format('%');

let defaultState = {
  title: TITLE,
  introVisible: true,
  view: 'index',
  indexOptions: {
    q: '',
    p: 0,
    sort: false,
    agency: false,
    ward: false,
    showInactive: false
  },
  detailOptions: {
    id: null
  }
};

let app;
let views = {};

$(() => app.initialize());

app = {
  state: defaultState,
  views: {},

  initialize: function () {
    app.views = {
      indexView: new views.IndexView('#index-view'),
      detailView: new views.DetailView('#detail-view')
    };

    let paramStr = window.location.search.substring(1);
    app.setState(app.deserializeState(paramStr), { replace: true });

    $(window).on('popstate', function (e) {
      app.setState(e.originalEvent.state, { silent: true });
    });

    $(document).on('click', function (e) {
      let target = $(e.target);

      if (target.prop('tagName') !== 'A') { target = target.parents('a'); }

      let href = target.attr('href');
      if (href === '#back') {
        window.history.back();
        return false;
      }
      if (href === '') { return false; }
      if (!href || href.charAt(0) !== '?') { return true; }

      if (href === '?') {
        defaultState.introVisible = true;
        app.setState(defaultState, { resetAll: true });
      } else {
        app.setState(app.deserializeState(href.substring(1)), { resetAll: true });
      }

      return false;
    });
  },

  setState: function (state, {
      silent = false,
      replace = false,
      resetPage = false,
      resetAll = false
    } = {}) {

    let changed = _.keys(state);
    app.state = _.defaultsDeep(state, resetAll ? defaultState : app.state);

    if (resetAll && state.view === 'detail') {
      defaultState.introVisible = false;
      app.state.introVisible = false;
    }

    if (resetPage) { app.state.indexOptions.p = 0; }

    if (app.state.introVisible) {
      $('#introduction').slideDown();
      $('.button-back').addClass('hidden');
    } else {
      $('#introduction').slideUp();
      $('.button-back').removeClass('hidden');
    }

    if (app.state.view === 'index') {
      app.views.indexView.show();
      app.views.detailView.hide();
    } else {
      app.views.detailView.show();
      app.views.indexView.hide();
    }

    if (resetAll || resetPage || _.includes(changed, 'indexOptions')) {
      app.views.indexView.update(app.state.indexOptions);
    }
    if (resetAll || _.includes(changed, 'detailOptions')) {
      app.views.detailView.update(app.state.detailOptions);
    }

    if (silent) { return; }

    window.history[replace ? 'replaceState' : 'pushState'](
      app.state,
      app.state.title,
      '?' + app.serializeState(app.state)
    );
  },

  serializeState: function (state) {
    switch (state.view) {
    case 'index':
      return _(state.indexOptions)
        .toPairs()
        .filter(([k, v]) => v)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .value()
        .join('&');
    case 'detail':
      return state.detailOptions.id ? `id=${state.detailOptions.id}` : '';
    default:
      return '';
    }
  },

  deserializeState: function (str) {
    if (!str) { return defaultState; }

    let [detailOptions, indexOptions] = _(str.split('&'))
      .map((p) => p.split('='))
      .partition(([k]) => _(app.state.detailOptions).keys().includes(k))
      .map((arr) => _(arr).fromPairs().mapValues((v) => decodeURIComponent(v)).value())
      .value();

    let view = detailOptions.id ? 'detail' : 'index';

    return { detailOptions, indexOptions, view };
  }
};

views.IndexView = function (sel) {
  let view = this;
  this.state = {};
  this.el = d3.select(sel);
  this.tbody = this.el.select('tbody');

  this.$el = $(sel);

  this.$el.find('#hide-inactive').change(function (e) {
    let showInactive = !$(e.target).prop('checked');
    view.state.showInactive = showInactive;
    app.setState({ indexOptions: { showInactive } }, { resetPage: true });
  });

  this.$el.find('.search-bar input').keyup(_.debounce(function (e) {
    let target = $(e.target);
    let q = target.val();
    if (q !== '') {
      target.parent().addClass('text-entered');
    } else {
      target.parent().removeClass('text-entered');
    }
    view.state.q = q;
    if (view.active) {
      app.setState({ indexOptions: { q } }, { replace: true, resetPage: true });
    } else {
      app.setState({ view: 'index', indexOptions: { q } }, { resetAll: true });
    }
  }, 200));

  this.$el.find('.search-bar .clear-search').click(function (e) {
    $(e.target).siblings('.search-bar input').val('').keyup();
  });

  this.$el.find('.results thead th').click(function (e) {
    let target = $(e.target);
    let name = target.attr('name');
    let currentDir = target.hasClass('sort-asc') ? 'asc' : target.hasClass('sort-desc') ? 'desc' : 'none';

    target.parent().children()
      .removeClass('sort-asc')
      .removeClass('sort-desc');

    switch (currentDir) {
    case 'asc':
      target.addClass('sort-desc');
      app.setState({ indexOptions: { sort: name + '-desc' } }, { resetPage: true });
      break;
    case 'desc':
      app.setState({ indexOptions: { sort: false } }, { resetPage: true });
      break;
    default:
      target.addClass('sort-asc');
      app.setState({ indexOptions: { sort: name + '-asc' } }, { resetPage: true });
    }
  });

  d3.json(SUMMARY_PATH, function (error, data) {
    if (error) { return console.warn(error); }

    view.data = data;
    view.data.forEach(function (d) {
      d.complete_percent = d.active ?
        _(d.cumulative_funding.total_funding)
          .toPairs()
          .sortBy(([k, v]) => k)
          .last()[1].spent * 1000 / d.est_cost
          || 0 : 1;
    });

    view.fuse = new Fuse(data, {
      keys: ['title', 'agency'],
      tokenize: true,
      threshold: 0.5
    });

    let agencies = _(view.data)
      .map('agency')
      .uniq()
      .value()
      .sort();

    agencies.unshift('');

    view.el.select('.filters .agency-filter').selectAll('option')
      .data(agencies)
      .enter().append('option')
      .attr('value', (d) => d)
      .text((d) => d);

    view.$el.find('.filters .agency-filter').change(function (e) {
      let agency = $(e.target).val();
      view.state.agency = agency;
      app.setState({ indexOptions: { agency } }, { resetPage: true });
    }).chosen({
      'width': '280px',
      'allow_single_deselect': true
    });

    view.$el.find('.filters .ward-filter').change(function (e) {
      let ward = $(e.target).val();
      view.state.ward = ward;
      app.setState({ indexOptions: { ward } }, { resetPage: true });
    }).chosen({
      'width': '140px',
      'allow_single_deselect': true
    });

    if (view.pendingUpdate) { view.pendingUpdate(); }
  });
};

views.IndexView.prototype = {
  show: function () {
    this.$el.addClass('active');
    this.active = true;
  },

  hide: function () {
    this.$el.removeClass('active');
    this.active = false;
  },

  update: function (props) {
    var view = this;

    if (!this.data) {
      this.pendingUpdate = () => this.update(props);
      return;
    }

    if (props.q !== this.state.q) {
      this.state.q = props.q;
      let searchBar = this.$el.find('.search-bar');
      searchBar.children('input').val(props.q);
      if (props.q !== '') {
        searchBar.addClass('text-entered');
      } else {
        searchBar.removeClass('text-entered');
      }
    }

    if (props.agency !== this.state.agency) {
      this.state.agency = props.agency;
      this.$el.find('.filters .agency-filter').val(props.agency).trigger('chosen:updated');
    }

    if (props.ward !== this.state.ward) {
      this.state.ward = props.ward;
      this.$el.find('.filters .ward-filter').val(props.ward).trigger('chosen:updated');
    }

    if (props.showInactive !== this.state.showInactive) {
      this.state.showInactive = props.showInactive;
      this.$el.find('#hide-inactive').prop('checked', !props.showInactive);
    }

    let data = props.q ? this.fuse.search(props.q) : this.data;

    data = data.filter((d) =>
      (props.showInactive ? true : d.active) &&
      (props.ward ? d.ward === props.ward : true) &&
      (props.agency ? d.agency === props.agency : true)
    );

    if (props.sort && !props.q) {
      let [col, dir] = props.sort.split('-');
      data = _.sortBy(data, col);
      if (dir === 'desc') { data.reverse(); }
    }

    let page = parseInt(props.p, 10);
    let lastPage = Math.ceil(data.length / RESULTS_PER_PAGE) - 1;
    if (page > lastPage) { props.p = '0'; page = 0; }

    let hrefForPage = (p) => '?' + app.serializeState({
      view: 'index',
      indexOptions: _.defaults({ p }, props)
    });

    _.forEach({
      first: page > 0 ? hrefForPage(0) : '',
      prev: page > 0 ? hrefForPage(page - 1) : '',
      next: page < lastPage ? hrefForPage(page + 1) : '',
      last: page < lastPage ? hrefForPage(lastPage) : ''
    }, function (href, button) {
      view.el.selectAll(`.${button}-page`)
        .attr('href', href)
        .classed('disabled', href === '')
        .attr('aria-disabled', href === '');
    });

    this.el.selectAll('.current-page').text(page + 1);

    data = data.slice(RESULTS_PER_PAGE * page, RESULTS_PER_PAGE * (page + 1));

    this.tbody.html('');

    let rows = this.tbody.selectAll('tr')
      .data(data)
      .enter().append('tr')
      .on('click', function (d) {
        app.setState({ view: 'detail', detailOptions: { id: d.project_no } }, { resetAll: true });
      });

    rows.append('td')
      .attr('class', 'title')
      .append('a')
      .attr('href', (d) => `?id=${d.project_no}`)
      .text((d) => d.title);

    rows.append('td')
      .attr('class', 'agency')
      .text((d) => d.agency);

    rows.append('td')
      .attr('class', (d) => 'last-year' + (d.active ? '' : ' inactive'))
      .text((d) => 'FY' + d.last_year);

    rows.append('td')
      .attr('class', 'cost')
      .text((d) => DOLLAR_FORMAT(d.est_cost));

    rows.append('td')
      .attr('class', 'percent')
      .each(function (d) {
        let cell = d3.select(this);
        let percent = PERCENT_FORMAT(d.complete_percent);

        cell.append('span')
          .attr('class', 'bar-label')
          .text(percent);

        cell.append('div')
          .attr('class', 'bar-wrapper')
          .append('div')
          .attr('class', 'bar')
          .style('width', percent);
      });
  }
};

views.DetailView = function (sel) {
  let view = this;
  this.el = d3.select(sel);
  this.$el = $(sel);
  this.template = _.template($('#detail-view-template').html(), {
    variable: 'd',
    imports: { DOLLAR_FORMAT }
  });

  this.$el.on('click', '.project-description .toggle-collapsed', function (e) {
    $(e.target).parents('.project-description').toggleClass('collapsed');
  });

  this.$el.on('change', '.project-cumulative-funding select[name=category]', function (e) {
    if (view.updateCumFunding) { view.updateCumFunding($(e.target).val()); }
  });

  this.$el.on('change', '#historical-plans-display', function (e) {
    if ($(e.currentTarget).children('input[name=display]:checked').val() === 'table') {
      view.$el.find('.project-historical-plans').removeClass('display-chart');
    } else {
      view.$el.find('.project-historical-plans').addClass('display-chart');
    }
  });
};

views.DetailView.prototype = {
  show: function () {
    this.$el.addClass('active');
  },

  hide: function () {
    this.$el.removeClass('active');
  },

  update: function ({ id }) {
    let view = this;

    this.el.html('');

    if (!id) { return; }

    d3.json(DETAIL_PATH_FOR_ID(id), function (error, data) {
      if (error) { return console.warn(error); }

      view.el.html(view.template(data));

      let maxYear = parseInt(_(data.cip_history)
        .values()
        .map((v) => _.toPairs(v.plan))
        .flatten()
        .filter(1)
        .map(0)
        .max()
        .substring(2), 10);
      let yearRange = _.range(data.first_year, maxYear + 1);
      let futureIdx = yearRange.length + CURRENT_YEAR - maxYear;

      view.el.select('.project-cumulative-funding select[name=category] optgroup.funding_by_phase')
        .selectAll('option')
        .data(_.keys(data.cumulative_funding.funding_by_phase))
        .enter().append('option')
        .attr('value', (d) => `funding_by_phase.${d}`)
        .text((d) => d);

      view.el.select('.project-cumulative-funding select[name=category] optgroup.funding_by_source')
        .selectAll('option')
        .data(_.keys(data.cumulative_funding.funding_by_source))
        .enter().append('option')
        .attr('value', (d) => `funding_by_source.${d}`)
        .text((d) => d);

      view.$el.find('.project-cumulative-funding select[name=category]')
        .chosen({ disable_search_threshold: 10 });

      let cumFundingSvg = view.el.select('.project-cumulative-funding .chart')
        .append('svg')
        .attr('width', YEAR_WIDTH * yearRange.length + CHART_LEFT_MARGIN)
        .attr('height', CUM_FUNDING_HEIGHT);

      function updateCumFunding(category = 'total_funding') {
        let catData = _.get(data.cumulative_funding, category);

        let table = view.el.select('.project-cumulative-funding .data-table');

        table.select('thead tr')
          .selectAll('th.year')
          .data(yearRange)
          .enter().append('th')
          .attr('class', 'year')
          .text((d) => 'FY' + d);

        let proposed = table.select('tr.proposed')
          .selectAll('td')
          .data(_.map(yearRange, (year) => _.get(catData, ['FY' + year, 'proposed'])));

        proposed.enter().append('td');
        proposed.html((d) => d ? DOLLAR_FORMAT(d * 1000) : '&ndash;');

        let allotted = table.select('tr.allotted')
          .selectAll('td')
          .data(_.map(yearRange, (year) => _.get(catData, ['FY' + year, 'allotted'])));

        allotted.enter().append('td');
        allotted.html((d) => d ? DOLLAR_FORMAT(d * 1000) : '&ndash;');

        let balance = table.select('tr.balance')
          .selectAll('td')
          .data(_.map(yearRange, (year) =>
              _.get(catData, ['FY' + year, 'allotted']) -
              _.get(catData, ['FY' + year, 'spent']))
          );

        balance.enter().append('td');
        balance.html((d, i) => d ? i >= futureIdx ? '*' : DOLLAR_FORMAT(d * 1000) : '&ndash;');

        let spent = table.select('tr.spent')
          .selectAll('td')
          .data(_.map(yearRange, (year) => _.get(catData, ['FY' + year, 'spent'])));

        spent.enter().append('td');
        spent.html((d, i) => d ? i >= futureIdx ? '*' : DOLLAR_FORMAT(d * 1000) : '&ndash;');

        let stackedData = _(catData)
          .map((v, k) => _.assign({ year: k }, v))
          .forEach((d) => {
            d.segments = [
              { name: 'spent', y0: 0, y1: d.spent },
              { name: 'balance', y0: d.spent, y1: d.allotted },
              { name: 'proposed', y0: d.allotted, y1: d.allotted + d.proposed }
            ];
            d.total = d.segments[d.segments.length - 1].y1;
          });

        let x = d3.scale.ordinal()
          .domain(_.map(yearRange, (d) => 'FY' + d))
          .rangeRoundPoints([CHART_LEFT_MARGIN, CHART_LEFT_MARGIN + (yearRange.length - 1) * YEAR_WIDTH]);

        let y = d3.scale.linear()
          .domain([0, d3.max(stackedData, (d) => d.total)])
          .range([CUM_FUNDING_HEIGHT, 0]);

        let bars = cumFundingSvg.selectAll('.bar')
          .data(stackedData, (d) => d.year);

        bars.enter().append('g')
          .attr('class', 'bar')
          .attr('transform', (d) => `translate(${x(d.year)},0)`);

        bars.exit().remove();

        let segments = bars.selectAll('rect')
          .data((d) => d.segments);

        segments.enter().append('rect')
          .attr('class', (d) => d.name)
          .attr('x', 0)
          .attr('width', CUM_FUNDING_BAR_WIDTH);

        segments.transition()
          .attr('y', (d) => y(d.y1))
          .attr('height', (d) => y(d.y0) - y(d.y1));
      }

      function updateHistPlans() {
        let histData = _(data.cip_history).map((cip, planYear) =>
          ({ planYear, est_cost: cip.est_cost, plan: _.map(yearRange, (year) => ({ year, proposed: cip.plan['FY' + year] })) })
        ).sortBy('planYear').reverse().value();

        let table = view.el.select('.project-historical-plans .data-table');

        view.el.selectAll('.project-historical-plans tbody')
          .selectAll('tr')
          .data(histData)
          .enter().append('tr')
          .append('th')
          .text((d) => d.planYear + ' Plan')
          .append('span')
          .attr('class', 'cost-label')
          .text((d) => `Est. cost: ${SHORT_DOLLAR_FORMAT(d.est_cost)}`);

        table.select('thead tr')
          .selectAll('th.year')
          .data(yearRange)
          .enter().append('th')
          .attr('class', 'year')
          .text((d) => 'FY' + d);

        table.selectAll('tbody tr')
          .selectAll('td')
          .data((d) => d.plan)
          .enter().append('td')
          .text((d) => _.isUndefined(d.proposed) ? '' : DOLLAR_FORMAT(d.proposed * 1000));

        let filteredHistData = _.map(histData, (d) => ({
          planYear: d.planYear,
          plan: _.filter(d.plan, (e) => !_.isUndefined(e.proposed))
        }));

        let x = d3.scale.ordinal()
          .domain(yearRange)
          .rangeRoundPoints([0, YEAR_WIDTH * (yearRange.length - 1)]);

        let radius = d3.scale.sqrt()
          .domain([0, _(filteredHistData).flatMap('plan').map('proposed').max()])
          .range([0, YEAR_WIDTH / 2]);

        let svg = view.el.select('.project-historical-plans .chart')
          .append('svg')
          .attr('width', YEAR_WIDTH * yearRange.length)
          .attr('height', YEAR_WIDTH * histData.length);

        svg.append('rect')
          .attr('class', 'bg')
          .attr('width', YEAR_WIDTH * yearRange.length)
          .attr('height', YEAR_WIDTH * histData.length);

        let plans = svg.selectAll('g.plan')
          .data(filteredHistData)
          .enter().append('g')
          .attr('class', 'plan')
          .attr('transform', (d, i) => `translate(${HIST_CHART_INDENT},${(i + .5) * YEAR_WIDTH})`);

        plans.append('line')
          .attr('x1', (d) => x(d3.min(d.plan, (e) => e.year)))
          .attr('y1', 0)
          .attr('x2', (d) => x(d3.max(d.plan, (e) => e.year)))
          .attr('y2', 0);

        let years = plans.selectAll('g.year')
          .data((d) => d.plan)
          .enter().append('g')
          .attr('class', 'year')
          .attr('transform', (d) => `translate(${x(d.year)},0)`);

        years.append('line')
          .attr('x1', 0)
          .attr('y1', -6)
          .attr('x2', 0)
          .attr('y2', 6);

        years.append('circle')
          .attr('r', (d) => radius(d.proposed));

        years.append('text')
          .attr('text-anchor', 'middle')
          .attr('y', (d) => {
            let r = radius(d.proposed);
            return r > 22 ? 5 : Math.max(r + 16, 22);
          })
          .text((d) => d.proposed ? SHORT_DOLLAR_FORMAT(d.proposed * 1000) : '$0');
      }

      updateCumFunding();
      updateHistPlans();

      view.updateCumFunding = updateCumFunding;
    });
  }
};
