/* global $ */

// TODO: Skip to main link
// TODO: Breakpoints for indexView table

const d3 = require('d3');
const _ = require('lodash');
const Fuse = require('fuse.js');

// TODO: Import specific modules from D3 (requires v4) and Lodash

const SUMMARY_PATH = 'data/summary.json';
const DETAIL_PATH_FOR_ID = (id) => `data/projects/${id}.json`;

const TITLE = 'DC Capital Improvement Tracker';
const CURRENT_YEAR = 2017;
const RESULTS_PER_PAGE = 20;
const CHART_LEFT_MARGIN = 135;
const YEAR_WIDTH = 100;
const CUM_FUNDING_HEIGHT = 120;
const CUM_FUNDING_BAR_WIDTH = 45;

const DEFAULT_STATE = {
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

const DOLLAR_FORMAT = d3.format('$,');
const PERCENT_FORMAT = d3.format('%');

let app;
let views = {};

$(() => app.initialize());

app = {
  state: DEFAULT_STATE,
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
      if (href === '') { return false; }
      if (!href || href.charAt(0) !== '?') { return true; }

      app.setState(app.deserializeState(href.substring(1)), { resetAll: true });
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
    app.state = _.defaultsDeep(state, resetAll ? DEFAULT_STATE : app.state);

    if (resetPage) { app.state.indexOptions.p = 0; }

    if (_.includes(changed, 'introVisible')) {
      // TODO: Hide/show introduction
    }
    if (resetAll || resetPage || _.includes(changed, 'indexOptions')) {
      app.views.indexView.update(app.state.indexOptions);
    }
    if (resetAll || _.includes(changed, 'detailOptions')) {
      app.views.detailView.update(app.state.detailOptions);
    }
    if (_.includes(changed, 'view')) {
      // TODO: Hide/show views
    }

    if (silent) { return; }

    window.history[replace ? 'replaceState' : 'pushState'](
      app.state,
      app.state.title,
      '?' + app.serializeState(app.state)
    );

    // TODO: Update title for detail view pages
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
    if (!str) { return DEFAULT_STATE; }

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
    app.setState({ indexOptions: { q } }, { replace: true, resetPage: true });
  }, 200));

  this.$el.find('.search-bar .clear-search').click(function (e) {
    $(e.target).siblings('.search-bar input').val('').keyup();
  });

  // TODO: Loading view

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
  update: function (props) {
    var view = this;

    if (!this.data) {
      this.pendingUpdate = () => this.update(props);
      return;
    }

    if (props.q !== this.state.q) {
      this.state.q = props.q;
      this.$el.find('.search-bar input').val(props.q).keyup();
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

    if (props.sort) { data = _.sortBy(data, props.sort); }

    // TODO: Sort controls

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
  this.el = d3.select(sel);
  this.template = _.template($('#detail-view-template').html(), {
    variable: 'd',
    imports: { DOLLAR_FORMAT }
  });
};

views.DetailView.prototype = {
  update: function ({ id }) {
    let view = this;

    this.el.html('');
    // TODO: Loading view

    if (!id) { return; }

    d3.json(DETAIL_PATH_FOR_ID(id), function (error, data) {
      if (error) { return console.warn(error); }

      view.el.html(view.template(data));

      let totalFunding = data.cumulative_funding.total_funding;
      let maxYear = parseInt(_(data.cip_history)
        .values()
        .map((v) => _.toPairs(v))
        .flatten()
        .filter(1)
        .maxBy(0)[0]
        .substring(2), 10);
      let yearRange = _.range(data.first_year, maxYear + 1);
      let futureIdx = yearRange.length + CURRENT_YEAR - maxYear;

      let table = view.el.select('.project-cumulative-funding .table table');

      // TODO: Pin row headers

      table.select('thead tr')
        .selectAll('th.year')
        .data(yearRange)
        .enter().append('th')
        .attr('class', 'year')
        .text((d) => 'FY' + d);

      table.select('tr.proposed')
        .selectAll('td')
        .data(_.map(yearRange, (year) => _.get(totalFunding, ['FY' + year, 'proposed'])))
        .enter().append('td')
        .html((d) => d ? DOLLAR_FORMAT(d) : '&ndash;');

      table.select('tr.allotted')
        .selectAll('td')
        .data(_.map(yearRange, (year) => _.get(totalFunding, ['FY' + year, 'allotted'])))
        .enter().append('td')
        .html((d) => d ? DOLLAR_FORMAT(d) : '&ndash;');

      table.select('tr.balance')
        .selectAll('td')
        .data(_.map(yearRange, (year) => _.get(totalFunding, ['FY' + year, 'allotted']) - _.get(totalFunding, ['FY' + year, 'spent'])))
        .enter().append('td')
        .html((d, i) => d ? i >= futureIdx ? '*' : DOLLAR_FORMAT(d) : '&ndash;');

      table.select('tr.spent')
        .selectAll('td')
        .data(_.map(yearRange, (year) => _.get(totalFunding, ['FY' + year, 'spent'])))
        .enter().append('td')
        .html((d, i) => d ? i >= futureIdx ? '*' : DOLLAR_FORMAT(d) : '&ndash;');

      let cumFundingData = _(totalFunding)
        .map((v, k) => _.assign({ year: k }, v))
        .forEach((d) => {
          d.segments = [
            { name: 'spent', y0: 0, y1: d.spent },
            { name: 'balance', y0: d.spent, y1: d.allotted },
            { name: 'proposed', y0: d.allotted, y1: d.allotted + d.proposed }
          ];
          d.total = d.segments[d.segments.length - 1].y1;
        });

      let cumFundingX = d3.scale.ordinal()
        .domain(_.map(yearRange, (d) => 'FY' + d))
        .rangeRoundPoints([CHART_LEFT_MARGIN, CHART_LEFT_MARGIN + (yearRange.length - 1) * YEAR_WIDTH]);

      let cumFundingY = d3.scale.linear()
        .domain([0, d3.max(cumFundingData, (d) => d.total)])
        .range([CUM_FUNDING_HEIGHT, 0]);

      view.el.select('.project-cumulative-funding .chart')
        .append('svg')
        .attr('width', YEAR_WIDTH * yearRange.length + CHART_LEFT_MARGIN)
        .attr('height', CUM_FUNDING_HEIGHT)
        .selectAll('g.bar')
        .data(cumFundingData)
        .enter().append('g')
        .attr('class', 'bar')
        .attr('transform', (d) => `translate(${cumFundingX(d.year)},0)`)
        .selectAll('rect')
        .data((d) => d.segments)
        .enter().append('rect')
        .attr('class', (d) => d.name)
        .attr('x', 0)
        .attr('y', (d) => cumFundingY(d.y1))
        .attr('width', CUM_FUNDING_BAR_WIDTH)
        .attr('height', (d) => cumFundingY(d.y0) - cumFundingY(d.y1));


      // TODO: Description read more button
      // TODO: Map
      // TODO: Historical Plans chart
    });
  }
};
