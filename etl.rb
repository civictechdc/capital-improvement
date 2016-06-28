#!/usr/bin/env ruby

require 'nokogiri'
require 'json'
require 'net/http'

FY_RANGE = 10..17
IS_BOLDED_LABEL = -> (cur) { !!cur.first_element_child }
PRIOR_FUNDING_TABLE_COLS = ['Allotments', 'Spent', 'Enc/ID-Adv', 'Pre-Enc', 'Balance']
MILESTONES = [:environmental_approvals, :design_start, :design_complete,
              :construction_start, :construction_complete, :closeout]
IMAGES_DIR = 'app/images/project_images/'
DATA_OUTPUT_FILE = 'app/data/data.json'
PROJECT_OUTPUT_DIR = 'app/data/projects/'
SUMMARY_OUTPUT_FILE = 'app/data/summary.json'

def scrape_title(page)
    cur = page.at("text:contains('Agency:')").previous_element
    title = cur.text.strip

    if cur.previous_element && cur.previous_element.text != ' ' then
        title = cur.previous_element.text + title
    end

    title = /(?:[A-Z,\d]+-){2}(.*)/.match(title)[1]

    return title
end

def scrape_image(page)
    cur = page.at("image")

    if cur then
        filename = cur['src'].split('/')[-1]
        if File.exist? IMAGES_DIR + filename then
            return filename
        end
    end
end

def scrape_field(page, field)
    cur = page.at("text:contains('#{field}:')")

    if cur then
        cur = cur.next_element
        if !IS_BOLDED_LABEL.call(cur) then
            return cur.text.strip
        end
    end
end

def scrape_field_single_el(page, field)
    cur = page.at("text:contains('#{field}:')")

    if cur then
        return cur.css('> text()').text.strip
    end
end

def scrape_paragraph(page, heading)
    scrape_paragraph_with_end_test(page, heading, &IS_BOLDED_LABEL)
end

def scrape_paragraph_with_end_test(page, heading, &end_test)
    cur = page.at("text:contains('#{heading}:')")

    if cur then
        cur = cur.next_element
        paragraph = ""
        until end_test.call(cur) do
            l = cur.text
            paragraph += l
            cur = cur.next_element
        end

        return paragraph.strip
    end
end

def scrape_funding_table(page, type, fy)
    type_sym = type.downcase.to_sym
    cur = page.at("b:contains('#{type}')").parent
    rows = []

    while IS_BOLDED_LABEL.call(cur) do cur = cur.next_element end

    until cur.text.include? 'TOTALS' do
        row = { :prior_funding => {}, :proposed_funding => {} }
        row[type_sym] = cur.text.strip.gsub("  ", " ")

        x = cur['left'].to_i

        cur = cur.next_element
        while cur['left'].to_i == x do
            row[type_sym] += " " + cur.text.strip
            cur = cur.next_element
        end

        for col in PRIOR_FUNDING_TABLE_COLS do
            row[:prior_funding][col] = cur.text.gsub(/\D/,'').to_i
            cur = cur.next_element
        end

        for yy in fy..(fy + 5) do
            row[:proposed_funding]["FY20#{yy}"] = cur.text.gsub(/\D/,'').to_i
            cur = cur.next_element
        end

        unless cur['left'].to_i == x then cur = cur.next_element end

        rows.push(row)
    end

    return rows
end

def scrape_milestones_table(page)
    cur = page.at("b:contains('Milestone Data')")

    if cur then
        milestones = {}
        cur = cur.parent.next_element
        div_x = cur['left'].to_i + cur['width'].to_i

        cur = cur.next_element.next_element

        for milestone in MILESTONES do
            dates = {}

            row_y = cur['top'].to_i
            cur = cur.next_element

            while (cur['top'].to_i - row_y).abs < 5 do
                if cur.text != ' ' then
                    if cur['left'].to_i < div_x then
                        dates[:projected] = cur.text.strip.gsub('/20', '/')
                    else
                        dates[:actual] = cur.text.strip.gsub('/20', '/')
                    end
                end

                cur = cur.next_element
            end

            milestones[milestone] = dates
        end

        return milestones
    end
end

pages = []

for fy in FY_RANGE do
    path = "xml/fy#{fy}.xml"
    fi = File.open(path)
    doc = Nokogiri::XML(fi)

    for page in doc.css('page') do
        unless page.text.include? 'Project No:' then next end

        data = {}

        data[:cip_fy] = fy

        data[:title] = scrape_title(page)
        data[:image] = scrape_image(page)
        data[:agency] = scrape_field(page, 'Agency')
        data[:implementing_agency] = scrape_field(page, 'Implementing Agency')
        data[:project_no] = scrape_field(page, 'Project No')
        data[:ward] = scrape_field(page, 'Ward')
        data[:location] = scrape_field(page, 'Location')
        data[:facility] = scrape_field(page, 'Facility Name or Identifier')
        data[:status] = scrape_field(page, 'Status')
        data[:est_cost] = scrape_field(page, 'Estimated Full Funding Cost')
        data[:description] = scrape_paragraph(page, 'Description')
        data[:justification] = scrape_paragraph(page, 'Justification')
        data[:progress_assessment] = scrape_paragraph(page, 'Progress Assessment')
        data[:funding_by_phase] = scrape_funding_table(page, 'Phase', fy)
        data[:funding_by_source] = scrape_funding_table(page, 'Source', fy)
        data[:milestones] = scrape_milestones_table(page)
        data[:related_projects] = scrape_paragraph_with_end_test(page, 'Related Projects') { |cur|
            cur.text.include?('(Dollars in Thousands)') ||
            cur.text.include?('Milestone Data')
        }

        if fy == 10 then
            data[:useful_life] = scrape_field_single_el(page, 'Useful Life of the Project')
        else
            data[:useful_life] = scrape_field(page, 'Useful Life of the Project')
        end

        if data[:useful_life] && data[:useful_life] != '' then
            data[:useful_life] = data[:useful_life].to_i
        end

        if data[:est_cost] && data[:est_cost] != '' then
            data[:est_cost] = data[:est_cost].gsub(/\D/,'').to_i
        end

        pages.push(data)
    end
end

File.open(DATA_OUTPUT_FILE, 'w') do |fo|
    fo.write(pages.to_json)
end

projects = {}

for page in pages do
    project_no = page[:project_no]
    unless projects[project_no] then
        projects[project_no] = {}
    end

    projects[project_no][:active] = page[:cip_fy] == FY_RANGE.last

    overwrite = -> (sym) {
        if page[sym] then projects[project_no][sym] = page[sym] end
    }

    overwrite.call(:project_no)
    overwrite.call(:title)
    overwrite.call(:image)
    overwrite.call(:agency)
    overwrite.call(:implementing_agency)
    overwrite.call(:ward)
    overwrite.call(:location)
    overwrite.call(:facility)
    overwrite.call(:status)
    overwrite.call(:description)
    overwrite.call(:justification)
    overwrite.call(:progress_assessment)
    overwrite.call(:related_projects)
    overwrite.call(:milestones)
    overwrite.call(:est_cost)
    overwrite.call(:useful_life)

    unless projects[project_no][:cip_tables] then
        projects[project_no][:cip_tables] = []
    end

    projects[project_no][:cip_tables].push({
        :fy => page[:cip_fy],
        :funding_by_phase => page[:funding_by_phase],
        :funding_by_source => page[:funding_by_source]
    })
end

def geolocate(address)
    if address == 'CITY-WIDE' || address == 'TBD' || address == 'WASHINGTON DC' || address.start_with?('WARD') then return {} end

    url = URI.parse("http://citizenatlas.dc.gov/newwebservices/locationverifier.asmx/findLocation?str=#{URI.escape(address)}")
    req = Net::HTTP::Get.new(url.to_s)
    res = Net::HTTP.start(url.host, url.port) { |http| http.request(req) }

    doc = Nokogiri::XML(res.body)
    cur = doc.at_xpath('//LATITUDE')
    lat = cur ? cur.text.to_f : nil
    cur = doc.at_xpath('//LONGITUDE')
    lon = cur ? cur.text.to_f : nil

    return { :lat => lat, :lon => lon }
end

projects.each do |project_no, project|
    coords = geolocate(project[:location])
    project[:lat] = coords[:lat]
    project[:lon] = coords[:lon]

    project[:first_year] = project[:cip_tables][0][:fy] + 2000
    project[:last_year] = project[:cip_tables][-1][:fy] + 2000
    project[:cip_history] = {}

    for cip in project[:cip_tables] do
        total = cip[:funding_by_phase].inject({}) do |sum, phase|
            phase[:proposed_funding].each do |fy, funds|
                if sum[fy] then
                    sum[fy] += funds
                else
                    sum[fy] = funds
                end

                if cip[:fy] == FY_RANGE.last && funds > 0 then
                    project[:last_year] = [project[:last_year], fy.gsub(/\D/,'').to_i].max
                end
            end

            sum
        end

        project[:cip_history]["FY20#{cip[:fy]}"] = total
    end

    project[:cumulative_funding] = {}

    for sym in [:funding_by_phase, :funding_by_source] do
        funds = {}

        for cip in project[:cip_tables] do
            fy = cip[:fy]
            for li in cip[sym] do
                name = li[:phase] || li[:source]
                unless funds[name] then
                    funds[name] = {}
                end

                allotted = li[:prior_funding]['Allotments']
                spent = li[:prior_funding]['Allotments'] - li[:prior_funding]['Balance']
                proposed = li[:proposed_funding]["FY20#{fy}"]

                funds[name]["FY20#{fy}"] = {
                    :allotted => allotted,
                    :spent => spent,
                    :proposed => proposed
                }

                if fy == FY_RANGE.last then
                    for yy in (fy + 1)..[fy + 5, project[:last_year] - 2000].min do
                        allotted += proposed
                        proposed = li[:proposed_funding]["FY20#{yy}"]

                        funds[name]["FY20#{yy}"] = {
                            :allotted => allotted,
                            :spent => spent,
                            :proposed => proposed
                        }
                    end
                end
            end
        end

        project[:cumulative_funding][sym] = funds
    end

    total_cum_funding = {}

    project[:cumulative_funding][:funding_by_phase].each do |phase, years|
        years.each do |fy, funds|
            if total_cum_funding[fy] then
                total_cum_funding[fy].each do |col, sum|
                    total_cum_funding[fy][col] += funds[col]
                end
            else
                total_cum_funding[fy] = funds
            end
        end
    end

    project[:cumulative_funding][:total_funding] = total_cum_funding

    unless project[:est_cost] then
        cost = 0
        total_cum_funding.each do |fy, funds|
            cost = [cost, funds[:allotted] + funds[:proposed]].max
        end
        project[:est_cost] = cost * 1000
    end

    project.delete(:cip_tables)

    File.open("#{PROJECT_OUTPUT_DIR}#{project_no}.json", 'w') do |fo|
        fo.write(project.to_json)
    end
end

summary = projects.values.map do |project|
    {
        :project_no => project[:project_no],
        :title => project[:title],
        :agency => project[:agency],
        :implementing_agency => project[:implementing_agency],
        :ward => project[:ward],
        :location => project[:location],
        :lat => project[:lat],
        :lon => project[:lon],
        :est_cost => project[:est_cost],
        :active => project[:active],
        :first_year => project[:first_year],
        :last_year => project[:last_year],
        :cumulative_funding => {
            :total_funding => project[:cumulative_funding][:total_funding]
        }
    }
end

File.open(SUMMARY_OUTPUT_FILE, 'w') do |fo|
    fo.write(summary.to_json)
end
